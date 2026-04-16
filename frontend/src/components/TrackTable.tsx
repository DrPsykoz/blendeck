"use client";

import { Track, TransitionScore, fetchPreviewUrl, previewStreamUrl } from "@/lib/api";
import TransitionBadge from "./TransitionBadge";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Play, Pause, Volume2, Loader2, Headphones } from "lucide-react";
import Image from "next/image";
import { useRef, useState, useCallback, useEffect } from "react";

interface TrackTableProps {
  tracks: Track[];
  transitions?: TransitionScore[];
  onReorder: (tracks: Track[]) => void;
  currentSpotifyUri?: string | null;
  onPlaySpotify?: (uri: string) => void;
}

function formatDuration(ms: number): string {
  const min = Math.floor(ms / 60000);
  const sec = Math.floor((ms % 60000) / 1000);
  return `${min}:${sec.toString().padStart(2, "0")}`;
}

function getCamelotColor(letter: string): string {
  return letter === "B"
    ? "bg-blue-500/20 text-blue-300 border-blue-500/30"
    : "bg-purple-500/20 text-purple-300 border-purple-500/30";
}

function getEnergyBarColor(energy: number): string {
  if (energy >= 0.8) return "bg-red-500";
  if (energy >= 0.6) return "bg-orange-500";
  if (energy >= 0.4) return "bg-yellow-500";
  if (energy >= 0.2) return "bg-green-500";
  return "bg-blue-500";
}

function SortableRow({
  track,
  index,
  transition,
  isPlaying,
  isLoading,
  playProgress,
  onTogglePlay,
  isSpotifyPlaying,
  onPlaySpotify,
}: {
  track: Track;
  index: number;
  transition?: TransitionScore;
  isPlaying: boolean;
  isLoading: boolean;
  playProgress: number;
  onTogglePlay: (track: Track) => void;
  isSpotifyPlaying: boolean;
  onPlaySpotify?: (uri: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition: dndTransition } =
    useSortable({ id: track.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition: dndTransition,
  };

  const af = track.audio_features;

  return (
    <>
      {/* Transition indicator between rows */}
      {index > 0 && transition && (
        <tr>
          <td colSpan={10} className="py-0.5 px-4">
            <div className="flex justify-center">
              <TransitionBadge transition={transition} compact />
            </div>
          </td>
        </tr>
      )}
      <tr
        ref={setNodeRef}
        style={style}
        className={`group border-b border-spotify-gray/30 transition-colors ${
          isSpotifyPlaying ? "bg-spotify-green/10" : isPlaying ? "bg-spotify-green/5" : "hover:bg-spotify-gray/30"
        }`}
      >
        <td className="w-8 px-2 py-2">
          <button {...attributes} {...listeners} className="cursor-grab text-spotify-light/50 hover:text-white">
            <GripVertical className="h-4 w-4" />
          </button>
        </td>
        <td className="w-8 px-2 py-2 text-sm text-spotify-light">{index + 1}</td>
        <td className="px-2 py-2">
          <div className="flex items-center gap-3">
            {/* Album art with play overlay */}
            <button
              onClick={() => !isLoading && onTogglePlay(track)}
              disabled={isLoading}
              className="relative h-10 w-10 flex-shrink-0 overflow-hidden rounded bg-spotify-gray cursor-pointer group/play"
              title={isLoading ? "Chargement..." : (isPlaying ? "Pause" : "Écouter l'extrait")}
            >
              {track.album_image_url ? (
                <Image
                  src={track.album_image_url}
                  alt={track.album}
                  fill
                  className="object-cover"
                  sizes="40px"
                />
              ) : (
                <div className="flex h-full items-center justify-center text-xs text-spotify-light/30">♫</div>
              )}
              {/* Play/Pause/Loading overlay */}
              <div className={`absolute inset-0 flex items-center justify-center bg-black/50 transition-opacity ${
                isPlaying || isLoading ? "opacity-100" : "opacity-0 group-hover/play:opacity-100"
              }`}>
                {isLoading ? (
                  <Loader2 className="h-4 w-4 text-white animate-spin" />
                ) : isPlaying ? (
                  <Pause className="h-4 w-4 text-white" fill="white" />
                ) : (
                  <Play className="h-4 w-4 text-white" fill="white" />
                )}
              </div>
              {/* Progress ring */}
              {isPlaying && (
                <svg className="absolute inset-0 h-10 w-10 -rotate-90" viewBox="0 0 40 40">
                  <circle
                    cx="20" cy="20" r="18"
                    fill="none"
                    stroke="rgb(30, 215, 96)"
                    strokeWidth="2"
                    strokeDasharray={`${playProgress * 113} 113`}
                    className="transition-all duration-300"
                  />
                </svg>
              )}
            </button>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <p className={`truncate text-sm font-medium ${isPlaying ? "text-spotify-green" : ""}`}>
                  {track.name}
                </p>
                {isPlaying && (
                  <Volume2 className="h-3 w-3 flex-shrink-0 animate-pulse text-spotify-green" />
                )}
              </div>
              <p className="truncate text-xs text-spotify-light">
                {track.artists.join(", ")}
              </p>
            </div>
          </div>
        </td>
        <td className="px-2 py-2 text-center text-sm tabular-nums">
          {af ? Math.round(af.tempo) : "—"}
        </td>
        <td className="px-2 py-2 text-center">
          {track.camelot ? (
            <span
              className={`inline-block rounded border px-2 py-0.5 text-xs font-mono font-semibold ${getCamelotColor(track.camelot.letter)}`}
            >
              {track.camelot.number}{track.camelot.letter}
            </span>
          ) : (
            <span className="text-xs text-spotify-light/50">—</span>
          )}
        </td>
        <td className="px-2 py-2">
          {af ? (
            <div className="flex items-center gap-2">
              <div className="h-2 w-16 rounded-full bg-spotify-gray">
                <div
                  className={`h-2 rounded-full ${getEnergyBarColor(af.energy)}`}
                  style={{ width: `${af.energy * 100}%` }}
                />
              </div>
              <span className="text-xs tabular-nums text-spotify-light">
                {(af.energy * 100).toFixed(0)}
              </span>
            </div>
          ) : (
            "—"
          )}
        </td>
        <td className="px-2 py-2 text-center text-xs tabular-nums text-spotify-light">
          {af ? (af.danceability * 100).toFixed(0) : "—"}
        </td>
        <td className="px-2 py-2 text-center text-xs tabular-nums text-spotify-light">
          {track.release_year ?? "—"}
        </td>
        <td className="px-2 py-2 text-right text-xs tabular-nums text-spotify-light">
          {formatDuration(track.duration_ms)}
        </td>
        <td className="px-2 py-2 text-center">
          {onPlaySpotify && (
            <button
              onClick={() => onPlaySpotify(track.uri)}
              className={`rounded-full p-1.5 transition-colors ${
                isSpotifyPlaying
                  ? "text-spotify-green bg-spotify-green/10"
                  : "text-spotify-light/50 hover:text-spotify-green hover:bg-spotify-green/10"
              }`}
              title="Jouer sur Spotify"
            >
              <Headphones className="h-3.5 w-3.5" />
            </button>
          )}
        </td>
      </tr>
    </>
  );
}

export default function TrackTable({ tracks, transitions, onReorder, currentSpotifyUri, onPlaySpotify }: TrackTableProps) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playingTrackId, setPlayingTrackId] = useState<string | null>(null);
  const [loadingTrackId, setLoadingTrackId] = useState<string | null>(null);
  const [playProgress, setPlayProgress] = useState(0);
  const [localTracks, setLocalTracks] = useState(tracks);

  // Sync localTracks when parent tracks change
  useEffect(() => {
    setLocalTracks(tracks);
  }, [tracks]);

  // Clean up audio on unmount
  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
    };
  }, []);

  const playAudio = useCallback((url: string, trackId: string) => {
    if (audioRef.current) {
      audioRef.current.pause();
    }

    const audio = new Audio(url);
    audio.volume = 0.5;
    audioRef.current = audio;
    setPlayingTrackId(trackId);
    setPlayProgress(0);

    audio.addEventListener("timeupdate", () => {
      if (audio.duration) {
        setPlayProgress(audio.currentTime / audio.duration);
      }
    });

    audio.addEventListener("ended", () => {
      setPlayingTrackId(null);
      setPlayProgress(0);
    });

    audio.addEventListener("error", () => {
      setPlayingTrackId(null);
      setPlayProgress(0);
    });

    audio.play().catch(() => {
      setPlayingTrackId(null);
    });
  }, []);

  const handleTogglePlay = useCallback(async (track: Track) => {
    // If same track, toggle pause/play
    if (playingTrackId === track.id && audioRef.current) {
      audioRef.current.pause();
      setPlayingTrackId(null);
      setPlayProgress(0);
      return;
    }

    // If we already have the URL, play via proxy
    if (track.preview_url) {
      playAudio(previewStreamUrl(track.id, track.name, track.artists[0] || ""), track.id);
      return;
    }

    // Fetch preview URL on-demand
    setLoadingTrackId(track.id);
    try {
      const url = await fetchPreviewUrl(
        track.id,
        track.name,
        track.artists[0] || "",
      );
      setLoadingTrackId(null);
      if (url) {
        // Update local track data so we don't fetch again
        setLocalTracks((prev) =>
          prev.map((t) => (t.id === track.id ? { ...t, preview_url: url } : t)),
        );
        playAudio(previewStreamUrl(track.id, track.name, track.artists[0] || ""), track.id);
      }
    } catch {
      setLoadingTrackId(null);
    }
  }, [playingTrackId, playAudio]);

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = localTracks.findIndex((t) => t.id === active.id);
    const newIndex = localTracks.findIndex((t) => t.id === over.id);

    const newTracks = [...localTracks];
    const [moved] = newTracks.splice(oldIndex, 1);
    newTracks.splice(newIndex, 0, moved);
    setLocalTracks(newTracks);
    onReorder(newTracks);
  }

  // Build transition lookup
  const transitionMap = new Map<string, TransitionScore>();
  if (transitions) {
    for (const t of transitions) {
      transitionMap.set(t.to_track_id, t);
    }
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-spotify-gray bg-spotify-gray/20">
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={localTracks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-spotify-gray text-xs uppercase tracking-wider text-spotify-light">
                <th className="w-8 px-2 py-3" />
                <th className="w-8 px-2 py-3">#</th>
                <th className="px-2 py-3">Titre</th>
                <th className="px-2 py-3 text-center">BPM</th>
                <th className="px-2 py-3 text-center">Key</th>
                <th className="px-2 py-3">Énergie</th>
                <th className="px-2 py-3 text-center">Dance</th>
                <th className="px-2 py-3 text-center">Année</th>
                <th className="px-2 py-3 text-right">Durée</th>
                {onPlaySpotify && <th className="px-2 py-3 text-center w-10">
                  <Headphones className="h-3 w-3 mx-auto" />
                </th>}
              </tr>
            </thead>
            <tbody>
              {localTracks.map((track, i) => (
                <SortableRow
                  key={track.id}
                  track={track}
                  index={i}
                  transition={transitionMap.get(track.id)}
                  isPlaying={playingTrackId === track.id}
                  isLoading={loadingTrackId === track.id}
                  playProgress={playingTrackId === track.id ? playProgress : 0}
                  onTogglePlay={handleTogglePlay}
                  isSpotifyPlaying={currentSpotifyUri === track.uri}
                  onPlaySpotify={onPlaySpotify}
                />
              ))}
            </tbody>
          </table>
        </SortableContext>
      </DndContext>
    </div>
  );
}
