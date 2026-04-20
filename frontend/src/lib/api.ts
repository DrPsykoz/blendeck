import { getValidToken } from "./spotify-auth";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export function previewStreamUrl(
	trackId: string,
	name?: string,
	artist?: string,
): string {
	const params = new URLSearchParams();
	if (name) params.set("name", name);
	if (artist) params.set("artist", artist);
	const qs = params.toString();
	return `${API_URL}/api/playlists/preview-stream/${trackId}${qs ? `?${qs}` : ""}`;
}

async function apiFetch<T>(
	path: string,
	options: RequestInit = {},
): Promise<T> {
	const token = await getValidToken();
	if (!token) throw new Error("Not authenticated");

	const response = await fetch(`${API_URL}${path}`, {
		...options,
		headers: {
			"Content-Type": "application/json",
			Authorization: `Bearer ${token}`,
			...options.headers,
		},
	});

	if (!response.ok) {
		const error = await response
			.json()
			.catch(() => ({ detail: "Unknown error" }));
		throw new Error(error.detail || `API error: ${response.status}`);
	}

	return response.json();
}

// Types matching backend models
export interface PlaylistSummary {
	id: string;
	name: string;
	description: string | null;
	image_url: string | null;
	track_count: number;
	owner: string;
}

export interface CamelotKey {
	number: number;
	letter: string;
}

export interface AudioFeatures {
	tempo: number;
	key: number;
	mode: number;
	energy: number;
	danceability: number;
	valence: number;
	loudness: number;
	acousticness: number;
	instrumentalness: number;
	speechiness: number;
	liveness: number;
	duration_ms: number;
	time_signature: number;
}

export interface Track {
	id: string;
	name: string;
	artists: string[];
	album: string;
	album_image_url: string | null;
	duration_ms: number;
	preview_url: string | null;
	uri: string;
	release_year: number | null;
	audio_features: AudioFeatures | null;
	camelot: CamelotKey | null;
}

export interface TransitionScore {
	from_track_id: string;
	to_track_id: string;
	total_score: number;
	bpm_score: number;
	key_score: number;
	energy_score: number;
	danceability_score: number;
	year_score: number;
}

export interface GeneratedSet {
	tracks: Track[];
	transitions: TransitionScore[];
	total_score: number;
	energy_curve: number[];
}

export interface AuthUser {
	id: string;
	email: string | null;
	display_name: string | null;
	is_admin: boolean;
}

export interface AdminRecentFile {
	name: string;
	size_bytes: number;
	size_mb: number;
	path: string;
}

export interface AdminCacheSection {
	exists?: boolean;
	files: number;
	size_bytes: number;
	size_mb: number;
	recent_files?: AdminRecentFile[];
	items?: AdminRecentFile[];
}

export interface AdminCacheOverview {
	admin_email: string;
	cache_root: string;
	tracks: AdminCacheSection;
	mixes: AdminCacheSection;
	transitions: AdminCacheSection;
	metadata: AdminCacheSection;
	total: {
		size_bytes: number;
		size_mb: number;
	};
}

export interface AdminCacheClearResult {
	scope: string;
	total: {
		freed_bytes: number;
		freed_mb: number;
	};
}

export interface AdminCachedTrackItem {
	track_id: string;
	source: "tracks" | "previews";
	name: string | null;
	artist: string | null;
	file_name: string;
	size_bytes: number;
	size_mb: number;
	updated_at: number;
	stream_path: string;
}

export interface AdminCachedTracksList {
	total_files: number;
	returned: number;
	items: AdminCachedTrackItem[];
}

export interface YTMusicCandidate {
	video_id: string;
	title: string;
	artists: string;
	duration_seconds: number;
	score: number;
	thumbnail_url: string | null;
}

export interface SearchCandidatesResult {
	track_id: string;
	candidates: YTMusicCandidate[];
}

export interface RedownloadResult {
	track_id: string;
	video_id: string;
	size_mb: number;
	success: boolean;
}

// API functions
export async function fetchPlaylists(): Promise<PlaylistSummary[]> {
	return apiFetch<PlaylistSummary[]>("/api/playlists");
}

export async function fetchCurrentUser(): Promise<AuthUser> {
	return apiFetch<AuthUser>("/api/auth/me");
}

export async function fetchPlaylistTracks(
	playlistId: string,
): Promise<Track[]> {
	return apiFetch<Track[]>(`/api/playlists/${playlistId}/tracks`);
}

export async function fetchAdminCacheOverview(): Promise<AdminCacheOverview> {
	return apiFetch<AdminCacheOverview>("/api/admin/cache/overview");
}

export async function clearAdminCache(
	scope: "tracks" | "mixes" | "transitions" | "metadata" | "all",
): Promise<AdminCacheClearResult> {
	return apiFetch<AdminCacheClearResult>(`/api/admin/cache?scope=${scope}`, {
		method: "DELETE",
	});
}

export async function deleteAdminTrackCache(
	trackId: string,
	source: "tracks" | "previews" | "auto" = "auto",
): Promise<{
	track_id: string;
	source?: "tracks" | "previews" | "auto";
	deleted: boolean;
	freed_bytes?: number;
	freed_mb?: number;
	message?: string;
}> {
	const params = new URLSearchParams({ source });
	return apiFetch(
		`/api/admin/cache/tracks/${encodeURIComponent(trackId)}?${params.toString()}`,
		{
			method: "DELETE",
		},
	);
}

export async function fetchAdminCachedTracks(
	search = "",
	limit = 200,
): Promise<AdminCachedTracksList> {
	const params = new URLSearchParams({ limit: String(limit) });
	if (search.trim()) params.set("q", search.trim());
	return apiFetch<AdminCachedTracksList>(
		`/api/admin/cache/tracks?${params.toString()}`,
	);
}

export async function fetchAdminTrackAudioBlob(
	trackId: string,
	source: "tracks" | "previews" | "auto" = "auto",
): Promise<Blob> {
	const token = await getValidToken();
	if (!token) throw new Error("Not authenticated");
	const params = new URLSearchParams({ source });

	const response = await fetch(
		`${API_URL}/api/admin/cache/tracks/${encodeURIComponent(trackId)}/stream?${params.toString()}`,
		{ headers: { Authorization: `Bearer ${token}` } },
	);
	if (!response.ok) {
		let detail = "Unknown error";
		try {
			const data = await response.json();
			detail = data.detail || detail;
		} catch {
			// no-op
		}
		throw new Error(detail || `API error: ${response.status}`);
	}
	return response.blob();
}

export async function searchAdminCandidates(
	trackId: string,
	artist: string,
	title: string,
	durationMs = 0,
): Promise<SearchCandidatesResult> {
	const params = new URLSearchParams({
		track_id: trackId,
		artist,
		title,
		duration_ms: String(durationMs),
	});
	return apiFetch<SearchCandidatesResult>(
		`/api/admin/search-candidates?${params.toString()}`,
	);
}

export async function redownloadAdminTrack(
	trackId: string,
	videoId: string,
	artist = "",
	title = "",
): Promise<RedownloadResult> {
	return apiFetch<RedownloadResult>("/api/admin/redownload-track", {
		method: "POST",
		body: JSON.stringify({
			track_id: trackId,
			video_id: videoId,
			artist,
			title,
		}),
	});
}

export async function fetchPreviewUrl(
	trackId: string,
	name: string,
	artist: string,
): Promise<string | null> {
	const data = await apiFetch<{ preview_url: string | null }>(
		`/api/playlists/preview/${trackId}?name=${encodeURIComponent(name)}&artist=${encodeURIComponent(artist)}`,
	);
	if (!data.preview_url) return null;
	// Return proxy URL to avoid CORS/expiry issues with Deezer CDN
	return previewStreamUrl(trackId);
}

// SSE-based analysis progress
export interface AnalysisProgress {
	current: number;
	total: number;
	track_id: string;
	name: string;
	artist: string;
	status: "analyzing" | "done" | "failed";
	features?: {
		tempo: number;
		energy: number;
		key: number;
		mode: number;
		danceability: number;
	};
}

export interface AnalysisCallbacks {
	onStart: (data: {
		total: number;
		need_analysis: number;
		cached: number;
	}) => void;
	onProgress: (data: AnalysisProgress) => void;
	onComplete: (tracks: Track[]) => void;
	onError: (message: string) => void;
}

export function analyzePlaylist(
	playlistId: string,
	callbacks: AnalysisCallbacks,
): () => void {
	let aborted = false;

	(async () => {
		const token = await getValidToken();
		if (!token || aborted) return;

		const response = await fetch(
			`${API_URL}/api/playlists/${playlistId}/analyze`,
			{
				headers: { Authorization: `Bearer ${token}` },
			},
		);

		if (!response.ok || !response.body) {
			callbacks.onError(`HTTP ${response.status}`);
			return;
		}

		const reader = response.body.getReader();
		const decoder = new TextDecoder();
		let buffer = "";
		let eventType = "";
		let eventData = "";

		const dispatch = () => {
			if (!eventType || !eventData) return;
			try {
				const data = JSON.parse(eventData);
				switch (eventType) {
					case "start":
						callbacks.onStart(data);
						break;
					case "progress":
						callbacks.onProgress(data);
						break;
					case "complete":
						callbacks.onComplete(data.tracks);
						break;
					case "error":
						callbacks.onError(data.message);
						break;
				}
			} catch {
				// skip parse errors
			}
			eventType = "";
			eventData = "";
		};

		const processLines = (lines: string[]) => {
			for (const line of lines) {
				if (line.startsWith("event: ")) {
					eventType = line.slice(7).trim();
				} else if (line.startsWith("data: ")) {
					eventData = line.slice(6);
				} else if (line === "") {
					dispatch();
				}
			}
		};

		while (!aborted) {
			const { value, done } = await reader.read();
			if (done) break;

			buffer += decoder.decode(value, { stream: true });
			const lines = buffer.split("\n");
			buffer = lines.pop() || "";
			processLines(lines);
		}

		// Process any remaining data in buffer after stream ends
		if (buffer.trim()) {
			const lines = buffer.split("\n");
			processLines(lines);
		}
		dispatch();
	})();

	return () => {
		aborted = true;
	};
}

export async function sortPlaylist(
	playlistId: string,
	sortBy: string,
	ascending: boolean = true,
): Promise<Track[]> {
	return apiFetch<Track[]>(
		`/api/sort-playlist/${playlistId}?sort_by=${sortBy}&ascending=${ascending}`,
		{ method: "POST" },
	);
}

export async function generateSet(
	playlistId: string,
	params?: {
		energy_curve?: string;
		bpm_weight?: number;
		key_weight?: number;
		energy_weight?: number;
		danceability_weight?: number;
		year_weight?: number;
		beam_width?: number;
	},
): Promise<GeneratedSet> {
	return apiFetch<GeneratedSet>(`/api/generate-set/${playlistId}`, {
		method: "POST",
		body: params ? JSON.stringify({ track_ids: [], ...params }) : undefined,
	});
}

export async function exportNewPlaylist(
	name: string,
	trackUris: string[],
	description: string = "",
): Promise<{ playlist_id: string }> {
	return apiFetch("/api/export/new-playlist", {
		method: "POST",
		body: JSON.stringify({
			name,
			description,
			track_uris: trackUris,
			public: false,
		}),
	});
}

export async function exportReorder(
	playlistId: string,
	trackUris: string[],
): Promise<{ status: string }> {
	return apiFetch("/api/export/reorder", {
		method: "PUT",
		body: JSON.stringify({
			playlist_id: playlistId,
			track_uris: trackUris,
		}),
	});
}

export async function exportFile(
	tracks: Track[],
	transitions: TransitionScore[],
	format: "csv" | "json" = "csv",
): Promise<Blob> {
	const token = await getValidToken();
	const response = await fetch(`${API_URL}/api/export/file`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Authorization: `Bearer ${token}`,
		},
		body: JSON.stringify({ tracks, transitions, format }),
	});

	if (!response.ok) throw new Error("Export failed");
	return response.blob();
}

// Mix generation
export interface MixProgress {
	status:
		| "downloading"
		| "cached"
		| "downloaded"
		| "skipped"
		| "trimming"
		| "analyzing"
		| "mixing"
		| "done"
		| "error";
	current: number;
	total: number;
	detail: string;
}

export interface MixCallbacks {
	onStart: (data: { total: number; crossfade: number }) => void;
	onProgress: (data: MixProgress) => void;
	onComplete: (mixId: string) => void;
	onError: (message: string) => void;
}

export interface TransitionConfig {
	style: "crossfade" | "fade" | "cut" | "echo" | "beatmatch" | "auto";
	duration: number;
}

export function generateMix(
	tracks: { id: string; name: string; artist: string; duration_ms: number }[],
	crossfade: number,
	callbacks: MixCallbacks,
	targetDuration: number = 0,
	transitionStyle: string = "crossfade",
	transitions?: TransitionConfig[],
	playlistId: string = "",
): () => void {
	let aborted = false;

	(async () => {
		const token = await getValidToken();
		if (!token || aborted) return;

		const response = await fetch(`${API_URL}/api/export/mix`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${token}`,
			},
			body: JSON.stringify({
				tracks,
				crossfade,
				target_duration: targetDuration,
				transition_style: transitionStyle,
				transitions: transitions || null,
				playlist_id: playlistId,
			}),
		});

		if (!response.ok || !response.body) {
			callbacks.onError(`HTTP ${response.status}`);
			return;
		}

		const reader = response.body.getReader();
		const decoder = new TextDecoder();
		let buffer = "";
		let eventType = "";
		let eventData = "";

		const dispatch = () => {
			if (!eventType || !eventData) return;
			try {
				const data = JSON.parse(eventData);
				switch (eventType) {
					case "start":
						callbacks.onStart(data);
						break;
					case "progress":
						callbacks.onProgress(data);
						break;
					case "complete":
						callbacks.onComplete(data.mix_id);
						break;
					case "error":
						callbacks.onError(data.message);
						break;
				}
			} catch {
				// skip parse errors
			}
			eventType = "";
			eventData = "";
		};

		const processLines = (lines: string[]) => {
			for (const line of lines) {
				if (line.startsWith("event: ")) {
					eventType = line.slice(7).trim();
				} else if (line.startsWith("data: ")) {
					eventData = line.slice(6);
				} else if (line === "") {
					dispatch();
				}
			}
		};

		while (!aborted) {
			const { value, done } = await reader.read();
			if (done) break;

			buffer += decoder.decode(value, { stream: true });
			const lines = buffer.split("\n");
			buffer = lines.pop() || "";
			processLines(lines);
		}

		if (buffer.trim()) {
			const lines = buffer.split("\n");
			processLines(lines);
		}
		dispatch();
	})();

	return () => {
		aborted = true;
	};
}

export function mixDownloadUrl(mixId: string): string {
	return `${API_URL}/api/export/mix/${mixId}`;
}

export function mixStreamUrl(mixId: string): string {
	return `${API_URL}/api/export/mix/${mixId}/stream`;
}

/** Fetch mix MP3 with auth and trigger a browser download. */
export async function downloadMix(mixId: string): Promise<void> {
	const token = await getValidToken();
	if (!token) throw new Error("Not authenticated");
	const res = await fetch(`${API_URL}/api/export/mix/${mixId}`, {
		headers: { Authorization: `Bearer ${token}` },
	});
	if (!res.ok) throw new Error(`Download failed: ${res.status}`);
	const blob = await res.blob();
	const url = URL.createObjectURL(blob);
	const a = document.createElement("a");
	a.href = url;
	a.download = `dj-mix-${mixId}.mp3`;
	a.click();
	URL.revokeObjectURL(url);
}

/** Fetch mix MP3 as a blob URL for audio playback (with auth). */
export async function loadMixAudioUrl(mixId: string): Promise<string> {
	const token = await getValidToken();
	if (!token) throw new Error("Not authenticated");
	const res = await fetch(`${API_URL}/api/export/mix/${mixId}/stream`, {
		headers: { Authorization: `Bearer ${token}` },
	});
	if (!res.ok) throw new Error(`Stream failed: ${res.status}`);
	const blob = await res.blob();
	return URL.createObjectURL(blob);
}

/** Fetch transition preview audio as a blob URL for playback (with auth). */
export async function loadTransitionPreview(
	fromId: string,
	toId: string,
	fromName: string,
	fromArtist: string,
	toName: string,
	toArtist: string,
	style: string = "crossfade",
	duration: number = 8,
): Promise<string> {
	const token = await getValidToken();
	if (!token) throw new Error("Not authenticated");
	const params = new URLSearchParams({
		from_id: fromId,
		to_id: toId,
		from_name: fromName,
		from_artist: fromArtist,
		to_name: toName,
		to_artist: toArtist,
		style,
		duration: String(duration),
	});
	const res = await fetch(
		`${API_URL}/api/export/transition-preview?${params}`,
		{
			headers: { Authorization: `Bearer ${token}` },
		},
	);
	if (!res.ok) throw new Error(`Transition preview failed: ${res.status}`);
	const blob = await res.blob();
	return URL.createObjectURL(blob);
}

export interface MixHistoryEntry {
	mix_id: string;
	created_at: number;
	track_count: number;
	track_names: string[];
	transition_style: string;
	crossfade_s: number;
	size_mb: number;
}

export async function fetchMixHistory(
	playlistId: string,
): Promise<MixHistoryEntry[]> {
	const token = await getValidToken();
	if (!token) return [];
	const res = await fetch(
		`${API_URL}/api/export/mix-history?playlist_id=${encodeURIComponent(playlistId)}`,
		{
			headers: { Authorization: `Bearer ${token}` },
		},
	);
	if (!res.ok) return [];
	return res.json();
}
