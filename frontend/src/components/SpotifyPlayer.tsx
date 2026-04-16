"use client";

import { useEffect, useRef, useState, useCallback, forwardRef, useImperativeHandle } from "react";
import { getValidToken } from "@/lib/spotify-auth";
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
  Disc3,
} from "lucide-react";

interface Track {
  uri: string;
  name: string;
  artists: string[];
  album_image_url: string | null;
}

interface SpotifyPlayerProps {
  tracks: Track[];
  onTrackChange?: (uri: string) => void;
}

export interface SpotifyPlayerHandle {
  playFromTrack: (uri: string) => void;
}

const SpotifyPlayer = forwardRef<SpotifyPlayerHandle, SpotifyPlayerProps>(function SpotifyPlayer(
  { tracks, onTrackChange },
  ref,
) {
  const playerRef = useRef<SpotifyPlayer | null>(null);
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTrack, setCurrentTrack] = useState<Spotify.Track | null>(null);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(0.5);
  const [isMuted, setIsMuted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sdkLoaded, setSdkLoaded] = useState(false);
  const progressInterval = useRef<ReturnType<typeof setInterval> | null>(null);
  const prevVolume = useRef(0.5);

  // Load SDK script
  useEffect(() => {
    if (document.getElementById("spotify-sdk")) {
      if (window.Spotify) setSdkLoaded(true);
      return;
    }

    window.onSpotifyWebPlaybackSDKReady = () => setSdkLoaded(true);

    const script = document.createElement("script");
    script.id = "spotify-sdk";
    script.src = "https://sdk.scdn.co/spotify-player.js";
    script.async = true;
    document.body.appendChild(script);

    return () => {
      window.onSpotifyWebPlaybackSDKReady = () => {};
    };
  }, []);

  // Initialize player once SDK is loaded
  useEffect(() => {
    if (!sdkLoaded || playerRef.current) return;

    const player = new window.Spotify.Player({
      name: "DJ Sorter",
      getOAuthToken: async (cb) => {
        const token = await getValidToken();
        if (token) cb(token);
      },
      volume: 0.5,
    });

    player.addListener("ready", ({ device_id }) => {
      setDeviceId(device_id);
      setIsReady(true);
      setError(null);
    });

    player.addListener("not_ready", () => {
      setIsReady(false);
    });

    player.addListener("player_state_changed", (state) => {
      if (!state) return;
      setIsPlaying(!state.paused);
      setPosition(state.position);
      setDuration(state.duration);
      const track = state.track_window.current_track;
      setCurrentTrack(track);
      if (track && onTrackChange) {
        onTrackChange(track.uri);
      }
    });

    player.addListener("initialization_error", ({ message }) => {
      setError(`Initialisation: ${message}`);
    });

    player.addListener("authentication_error", ({ message }) => {
      setError(`Auth: ${message}`);
    });

    player.addListener("account_error", ({ message }) => {
      setError("Un compte Spotify Premium est requis pour le lecteur intégré.");
    });

    player.connect();
    playerRef.current = player;

    return () => {
      player.disconnect();
      playerRef.current = null;
    };
  }, [sdkLoaded, onTrackChange]);

  // Progress ticker
  useEffect(() => {
    if (progressInterval.current) {
      clearInterval(progressInterval.current);
    }
    if (isPlaying) {
      progressInterval.current = setInterval(() => {
        setPosition((p) => p + 500);
      }, 500);
    }
    return () => {
      if (progressInterval.current) clearInterval(progressInterval.current);
    };
  }, [isPlaying]);

  const playAll = useCallback(async () => {
    if (!deviceId || tracks.length === 0) return;
    const token = await getValidToken();
    if (!token) return;

    const uris = tracks.map((t) => t.uri);
    try {
      await fetch(
        `https://api.spotify.com/v1/me/player/play?device_id=${deviceId}`,
        {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ uris }),
        },
      );
    } catch (e) {
      console.error("Failed to start playback", e);
    }
  }, [deviceId, tracks]);

  const playFromTrack = useCallback(
    async (uri: string) => {
      if (!deviceId || tracks.length === 0) return;
      const token = await getValidToken();
      if (!token) return;

      const uris = tracks.map((t) => t.uri);
      const offset = uris.indexOf(uri);

      try {
        await fetch(
          `https://api.spotify.com/v1/me/player/play?device_id=${deviceId}`,
          {
            method: "PUT",
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              uris,
              offset: { position: offset >= 0 ? offset : 0 },
            }),
          },
        );
      } catch (e) {
        console.error("Failed to start playback", e);
      }
    },
    [deviceId, tracks],
  );

  // Expose playFromTrack via ref
  useImperativeHandle(ref, () => ({
    playFromTrack: (uri: string) => {
      playFromTrack(uri);
    },
  }), [playFromTrack]);

  const togglePlay = useCallback(async () => {
    if (!playerRef.current) return;
    const state = await playerRef.current.getCurrentState();
    if (!state) {
      // No active playback, start from beginning
      await playAll();
    } else {
      await playerRef.current.togglePlay();
    }
  }, [playAll]);

  const handleVolumeChange = useCallback(
    (val: number) => {
      setVolume(val);
      setIsMuted(val === 0);
      playerRef.current?.setVolume(val);
    },
    [],
  );

  const toggleMute = useCallback(() => {
    if (isMuted) {
      handleVolumeChange(prevVolume.current);
    } else {
      prevVolume.current = volume;
      handleVolumeChange(0);
    }
  }, [isMuted, volume, handleVolumeChange]);

  const handleSeek = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!playerRef.current || duration === 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const pct = (e.clientX - rect.left) / rect.width;
    const ms = Math.round(pct * duration);
    playerRef.current.seek(ms);
    setPosition(ms);
  }, [duration]);

  const formatTime = (ms: number) => {
    const s = Math.floor(ms / 1000);
    const m = Math.floor(s / 60);
    return `${m}:${String(s % 60).padStart(2, "0")}`;
  };

  if (error) {
    return (
      <div className="fixed bottom-0 left-0 right-0 z-50 border-t border-spotify-gray bg-spotify-black/95 backdrop-blur-sm px-6 py-3">
        <div className="mx-auto max-w-7xl text-center text-sm text-yellow-400">
          {error}
        </div>
      </div>
    );
  }

  if (!isReady) {
    return (
      <div className="fixed bottom-0 left-0 right-0 z-50 border-t border-spotify-gray bg-spotify-black/95 backdrop-blur-sm px-6 py-3">
        <div className="mx-auto max-w-7xl flex items-center justify-center gap-2 text-sm text-gray-400">
          <Disc3 className="h-4 w-4 animate-spin" />
          Connexion au lecteur Spotify...
        </div>
      </div>
    );
  }

  const albumArt =
    currentTrack?.album?.images?.[0]?.url ?? null;
  const trackName = currentTrack?.name ?? "Aucun titre";
  const artistName =
    currentTrack?.artists?.map((a) => a.name).join(", ") ?? "";
  const progress = duration > 0 ? (position / duration) * 100 : 0;

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 border-t border-spotify-gray bg-spotify-black/95 backdrop-blur-sm">
      <div className="mx-auto max-w-7xl px-4 py-2">
        <div className="flex items-center gap-4">
          {/* Track info */}
          <div className="flex items-center gap-3 min-w-0 w-1/4">
            {albumArt ? (
              <img
                src={albumArt}
                alt=""
                className="h-12 w-12 rounded shadow-lg flex-shrink-0"
              />
            ) : (
              <div className="h-12 w-12 rounded bg-spotify-gray flex items-center justify-center flex-shrink-0">
                <Disc3 className="h-5 w-5 text-gray-500" />
              </div>
            )}
            <div className="min-w-0">
              <div className="text-sm font-medium truncate">{trackName}</div>
              <div className="text-xs text-gray-400 truncate">{artistName}</div>
            </div>
          </div>

          {/* Controls */}
          <div className="flex flex-col items-center flex-1">
            <div className="flex items-center gap-4 mb-1">
              <button
                onClick={() => playerRef.current?.previousTrack()}
                className="text-gray-400 hover:text-white transition"
              >
                <SkipBack className="h-4 w-4" fill="currentColor" />
              </button>
              <button
                onClick={togglePlay}
                className="flex h-8 w-8 items-center justify-center rounded-full bg-white text-black hover:scale-105 transition"
              >
                {isPlaying ? (
                  <Pause className="h-4 w-4" fill="currentColor" />
                ) : (
                  <Play className="h-4 w-4 ml-0.5" fill="currentColor" />
                )}
              </button>
              <button
                onClick={() => playerRef.current?.nextTrack()}
                className="text-gray-400 hover:text-white transition"
              >
                <SkipForward className="h-4 w-4" fill="currentColor" />
              </button>
            </div>

            {/* Progress bar */}
            <div className="flex w-full items-center gap-2 max-w-xl">
              <span className="text-[10px] text-gray-400 w-8 text-right tabular-nums">
                {formatTime(position)}
              </span>
              <div
                className="flex-1 h-1 bg-gray-700 rounded-full cursor-pointer group relative"
                onClick={handleSeek}
              >
                <div
                  className="h-full bg-white group-hover:bg-spotify-green rounded-full transition-colors relative"
                  style={{ width: `${Math.min(progress, 100)}%` }}
                >
                  <div className="absolute right-0 top-1/2 -translate-y-1/2 h-3 w-3 bg-white rounded-full shadow opacity-0 group-hover:opacity-100 transition" />
                </div>
              </div>
              <span className="text-[10px] text-gray-400 w-8 tabular-nums">
                {formatTime(duration)}
              </span>
            </div>
          </div>

          {/* Volume */}
          <div className="flex items-center gap-2 w-1/6 justify-end">
            <button onClick={toggleMute} className="text-gray-400 hover:text-white transition">
              {isMuted || volume === 0 ? (
                <VolumeX className="h-4 w-4" />
              ) : (
                <Volume2 className="h-4 w-4" />
              )}
            </button>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={volume}
              onChange={(e) => handleVolumeChange(parseFloat(e.target.value))}
              className="w-20 h-1 accent-white bg-gray-700 rounded-full appearance-none cursor-pointer
                [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white"
            />
          </div>
        </div>
      </div>
    </div>
  );
});

export default SpotifyPlayer;
export type { SpotifyPlayerProps };
