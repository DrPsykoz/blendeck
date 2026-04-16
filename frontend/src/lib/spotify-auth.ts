const CLIENT_ID = process.env.NEXT_PUBLIC_SPOTIFY_CLIENT_ID!;
const REDIRECT_URI =
	process.env.NEXT_PUBLIC_REDIRECT_URI || "http://localhost:3000/callback";
const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

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

export async function exchangeCode(code: string): Promise<void> {
	const codeVerifier = sessionStorage.getItem("code_verifier");
	if (!codeVerifier) throw new Error("Missing code verifier");

	const response = await fetch(`${API_URL}/api/auth/token`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		credentials: "include",
		body: JSON.stringify({
			code,
			code_verifier: codeVerifier,
			redirect_uri: REDIRECT_URI,
		}),
	});

	if (!response.ok) {
		throw new Error("Token exchange failed");
	}

	const data = await response.json();
	sessionStorage.removeItem("code_verifier");

	// Store access token in memory (refresh token is in httpOnly cookie)
	_accessToken = data.access_token;
	_tokenExpiry = Date.now() + data.expires_in * 1000;
}

async function refreshAccessToken(): Promise<{
	access_token: string;
	expires_in: number;
} | null> {
	try {
		const response = await fetch(`${API_URL}/api/auth/refresh`, {
			method: "POST",
			credentials: "include",
		});
		if (!response.ok) return null;
		return response.json();
	} catch {
		return null;
	}
}

// ── In-memory token storage (not persisted, not accessible via XSS on localStorage) ──
let _accessToken: string | null = null;
let _tokenExpiry: number = 0;

// One-time migration: clear old localStorage tokens from previous versions
if (typeof localStorage !== "undefined") {
	localStorage.removeItem("spotify_access_token");
	localStorage.removeItem("spotify_refresh_token");
	localStorage.removeItem("spotify_token_expiry");
}

export function saveTokens(
	accessToken: string,
	_refreshToken: string,
	expiresIn: number,
): void {
	_accessToken = accessToken;
	_tokenExpiry = Date.now() + expiresIn * 1000;
}

export function getAccessToken(): string | null {
	return _accessToken;
}

export function getRefreshToken(): string | null {
	// Refresh token is now in httpOnly cookie, not accessible from JS
	return null;
}

export function isTokenExpired(): boolean {
	if (!_tokenExpiry) return true;
	return Date.now() > _tokenExpiry - 60000; // 1 min buffer
}

export function clearTokens(): void {
	_accessToken = null;
	_tokenExpiry = 0;
	// Clear httpOnly refresh_token cookie via backend
	fetch(`${API_URL}/api/auth/logout`, {
		method: "POST",
		credentials: "include",
	}).catch(() => {});
}

export async function getValidToken(): Promise<string | null> {
	if (_accessToken && !isTokenExpired()) {
		return _accessToken;
	}

	// Try to refresh using httpOnly cookie
	const data = await refreshAccessToken();
	if (data) {
		_accessToken = data.access_token;
		_tokenExpiry = Date.now() + data.expires_in * 1000;
		return _accessToken;
	}

	_accessToken = null;
	_tokenExpiry = 0;
	return null;
}
