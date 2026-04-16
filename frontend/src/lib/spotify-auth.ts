const CLIENT_ID = process.env.NEXT_PUBLIC_SPOTIFY_CLIENT_ID!;
const REDIRECT_URI =
	process.env.NEXT_PUBLIC_REDIRECT_URI || "http://localhost:3000/callback";

const SCOPES = [
	"playlist-read-private",
	"playlist-read-collaborative",
	"playlist-modify-public",
	"playlist-modify-private",
	"streaming",
	"user-read-email",
	"user-read-private",
	"user-modify-playback-state",
	"user-read-playback-state",
].join(" ");

function generateRandomString(length: number): string {
	const possible =
		"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
	const array = new Uint8Array(length);
	crypto.getRandomValues(array);
	return Array.from(array, (byte) => possible[byte % possible.length]).join(
		"",
	);
}

async function sha256(plain: string): Promise<ArrayBuffer> {
	const encoder = new TextEncoder();
	const data = encoder.encode(plain);
	return crypto.subtle.digest("SHA-256", data);
}

function base64urlEncode(buffer: ArrayBuffer): string {
	const bytes = new Uint8Array(buffer);
	let str = "";
	bytes.forEach((byte) => (str += String.fromCharCode(byte)));
	return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function redirectToSpotifyAuth(): Promise<void> {
	const codeVerifier = generateRandomString(64);
	const hashed = await sha256(codeVerifier);
	const codeChallenge = base64urlEncode(hashed);

	sessionStorage.setItem("code_verifier", codeVerifier);

	const params = new URLSearchParams({
		response_type: "code",
		client_id: CLIENT_ID,
		scope: SCOPES,
		code_challenge_method: "S256",
		code_challenge: codeChallenge,
		redirect_uri: REDIRECT_URI,
	});

	window.location.href = `https://accounts.spotify.com/authorize?${params.toString()}`;
}

export async function exchangeCode(code: string): Promise<{
	access_token: string;
	refresh_token: string;
	expires_in: number;
}> {
	const codeVerifier = sessionStorage.getItem("code_verifier");
	if (!codeVerifier) throw new Error("Missing code verifier");

	const response = await fetch("https://accounts.spotify.com/api/token", {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({
			client_id: CLIENT_ID,
			grant_type: "authorization_code",
			code,
			redirect_uri: REDIRECT_URI,
			code_verifier: codeVerifier,
		}),
	});

	if (!response.ok) {
		throw new Error("Token exchange failed");
	}

	const data = await response.json();
	sessionStorage.removeItem("code_verifier");
	return data;
}

export async function refreshAccessToken(refreshToken: string): Promise<{
	access_token: string;
	refresh_token: string;
	expires_in: number;
}> {
	const response = await fetch("https://accounts.spotify.com/api/token", {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({
			client_id: CLIENT_ID,
			grant_type: "refresh_token",
			refresh_token: refreshToken,
		}),
	});

	if (!response.ok) throw new Error("Token refresh failed");
	return response.json();
}

// Token storage utilities
const TOKEN_KEY = "spotify_access_token";
const REFRESH_KEY = "spotify_refresh_token";
const EXPIRY_KEY = "spotify_token_expiry";

export function saveTokens(
	accessToken: string,
	refreshToken: string,
	expiresIn: number,
): void {
	localStorage.setItem(TOKEN_KEY, accessToken);
	localStorage.setItem(REFRESH_KEY, refreshToken);
	localStorage.setItem(EXPIRY_KEY, String(Date.now() + expiresIn * 1000));
}

export function getAccessToken(): string | null {
	return localStorage.getItem(TOKEN_KEY);
}

export function getRefreshToken(): string | null {
	return localStorage.getItem(REFRESH_KEY);
}

export function isTokenExpired(): boolean {
	const expiry = localStorage.getItem(EXPIRY_KEY);
	if (!expiry) return true;
	return Date.now() > Number(expiry) - 60000; // 1 min buffer
}

export function clearTokens(): void {
	localStorage.removeItem(TOKEN_KEY);
	localStorage.removeItem(REFRESH_KEY);
	localStorage.removeItem(EXPIRY_KEY);
}

export async function getValidToken(): Promise<string | null> {
	let token = getAccessToken();
	if (!token) return null;

	if (isTokenExpired()) {
		const refresh = getRefreshToken();
		if (!refresh) {
			clearTokens();
			return null;
		}
		try {
			const data = await refreshAccessToken(refresh);
			saveTokens(data.access_token, data.refresh_token, data.expires_in);
			token = data.access_token;
		} catch {
			clearTokens();
			return null;
		}
	}

	return token;
}
