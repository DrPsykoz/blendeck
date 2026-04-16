declare module "*.css" {
	const content: Record<string, string>;
	export default content;
}

// Spotify Web Playback SDK
interface SpotifyPlayer {
	new (options: {
		name: string;
		getOAuthToken: (cb: (token: string) => void) => void;
		volume?: number;
	}): SpotifyPlayer;
	connect(): Promise<boolean>;
	disconnect(): void;
	addListener(
		event: "ready",
		cb: (data: { device_id: string }) => void,
	): void;
	addListener(
		event: "not_ready",
		cb: (data: { device_id: string }) => void,
	): void;
	addListener(
		event: "player_state_changed",
		cb: (state: Spotify.PlaybackState | null) => void,
	): void;
	addListener(
		event:
			| "initialization_error"
			| "authentication_error"
			| "account_error",
		cb: (data: { message: string }) => void,
	): void;
	removeListener(event: string): void;
	getCurrentState(): Promise<Spotify.PlaybackState | null>;
	setName(name: string): Promise<void>;
	getVolume(): Promise<number>;
	setVolume(volume: number): Promise<void>;
	pause(): Promise<void>;
	resume(): Promise<void>;
	togglePlay(): Promise<void>;
	seek(position_ms: number): Promise<void>;
	previousTrack(): Promise<void>;
	nextTrack(): Promise<void>;
}

declare namespace Spotify {
	interface PlaybackState {
		paused: boolean;
		position: number;
		duration: number;
		track_window: {
			current_track: Track;
			previous_tracks: Track[];
			next_tracks: Track[];
		};
		repeat_mode: number;
		shuffle: boolean;
	}

	interface Track {
		uri: string;
		id: string | null;
		type: string;
		media_type: string;
		name: string;
		is_playable: boolean;
		album: {
			uri: string;
			name: string;
			images: { url: string; height: number; width: number }[];
		};
		artists: { uri: string; name: string }[];
	}
}

interface Window {
	onSpotifyWebPlaybackSDKReady: () => void;
	Spotify: {
		Player: SpotifyPlayer;
	};
}
