"use client";

import { useState, useEffect, useRef } from "react";
import { MixHistoryEntry, fetchMixHistory, mixStreamUrl, mixDownloadUrl } from "@/lib/api";
import { Download, Play, Pause, Clock, Music, ChevronDown, ChevronUp } from "lucide-react";

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function formatDate(ts: number): string {
  const d = new Date(ts * 1000);
  const now = new Date();
  const diff = (now.getTime() - d.getTime()) / 1000;
  if (diff < 60) return "À l'instant";
  if (diff < 3600) return `Il y a ${Math.floor(diff / 60)} min`;
  if (diff < 86400) return `Il y a ${Math.floor(diff / 3600)}h`;
  return d.toLocaleDateString("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

const STYLE_LABELS: Record<string, string> = {
  crossfade: "Crossfade",
  fade: "Fade",
  cut: "Cut",
  echo: "Echo",
  beatmatch: "Beatmatch",
  auto: "Auto",
};

export default function MixHistory({ playlistId }: { playlistId: string }) {
  const [history, setHistory] = useState<MixHistoryEntry[]>([]);
  const [expanded, setExpanded] = useState(false);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const loadHistory = async () => {
    const data = await fetchMixHistory(playlistId);
    setHistory(data);
  };

  useEffect(() => {
    loadHistory();
  }, [playlistId]);

  // Expose reload for parent
  useEffect(() => {
    (window as any).__reloadMixHistory = loadHistory;
    return () => { delete (window as any).__reloadMixHistory; };
  }, [playlistId]);

  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
    };
  }, []);

  const handlePlay = (mixId: string) => {
    if (playingId === mixId) {
      // Toggle pause/play
      if (audioRef.current) {
        if (audioRef.current.paused) {
          audioRef.current.play();
          setPlayingId(mixId);
        } else {
          audioRef.current.pause();
          setPlayingId(null);
        }
      }
      return;
    }

    // Stop current
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }

    const audio = new Audio(mixStreamUrl(mixId));
    audioRef.current = audio;
    setPlayingId(mixId);
    setProgress(0);
    setDuration(0);

    audio.addEventListener("loadedmetadata", () => {
      setDuration(audio.duration);
    });
    audio.addEventListener("timeupdate", () => {
      setProgress(audio.currentTime);
    });
    audio.addEventListener("ended", () => {
      setPlayingId(null);
      setProgress(0);
    });

    audio.play();
  };

  const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!audioRef.current || !duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    audioRef.current.currentTime = ratio * duration;
  };

  const handleDownload = (mixId: string) => {
    const a = document.createElement("a");
    a.href = mixDownloadUrl(mixId);
    a.download = `dj-mix-${mixId}.mp3`;
    a.click();
  };

  if (history.length === 0) return null;

  return (
    <div className="mt-4 rounded-xl border border-spotify-gray bg-spotify-darkgray/50 overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center justify-between px-4 py-3 text-sm font-medium hover:bg-spotify-gray/30 transition-colors"
      >
        <div className="flex items-center gap-2">
          <Clock className="h-4 w-4 text-spotify-light" />
          <span>Historique des mix ({history.length})</span>
        </div>
        {expanded ? <ChevronUp className="h-4 w-4 text-spotify-light" /> : <ChevronDown className="h-4 w-4 text-spotify-light" />}
      </button>

      {expanded && (
        <div className="border-t border-spotify-gray">
          {history.map((entry) => {
            const isPlaying = playingId === entry.mix_id;
            return (
              <div
                key={entry.mix_id}
                className={`border-b border-spotify-gray/50 px-4 py-3 last:border-b-0 ${
                  isPlaying ? "bg-spotify-green/5" : ""
                }`}
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 text-sm">
                      <Music className="h-3.5 w-3.5 shrink-0 text-spotify-light" />
                      <span className="font-medium truncate">
                        {entry.track_count} pistes — {STYLE_LABELS[entry.transition_style] || entry.transition_style}
                      </span>
                      <span className="shrink-0 text-xs text-spotify-light">
                        {entry.size_mb} MB
                      </span>
                    </div>
                    <div className="mt-0.5 text-[11px] text-spotify-light truncate">
                      {entry.track_names.slice(0, 4).join(" → ")}
                      {entry.track_names.length > 4 && ` → +${entry.track_names.length - 4}`}
                    </div>
                    <div className="mt-0.5 text-[10px] text-spotify-light/60">
                      {formatDate(entry.created_at)} · Crossfade {entry.crossfade_s}s
                    </div>
                  </div>

                  <div className="flex shrink-0 items-center gap-1.5">
                    <button
                      onClick={() => handlePlay(entry.mix_id)}
                      className={`rounded-full p-2 transition-colors ${
                        isPlaying
                          ? "bg-spotify-green text-black"
                          : "bg-spotify-gray/50 text-spotify-light hover:bg-spotify-gray hover:text-white"
                      }`}
                      title={isPlaying ? "Pause" : "Écouter"}
                    >
                      {isPlaying && !audioRef.current?.paused ? (
                        <Pause className="h-3.5 w-3.5" />
                      ) : (
                        <Play className="h-3.5 w-3.5" />
                      )}
                    </button>
                    <button
                      onClick={() => handleDownload(entry.mix_id)}
                      className="rounded-full bg-spotify-gray/50 p-2 text-spotify-light transition-colors hover:bg-spotify-gray hover:text-white"
                      title="Télécharger"
                    >
                      <Download className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>

                {/* Progress bar for playing mix */}
                {isPlaying && duration > 0 && (
                  <div className="mt-2">
                    <div
                      className="h-1.5 w-full cursor-pointer rounded-full bg-spotify-gray"
                      onClick={handleSeek}
                    >
                      <div
                        className="h-full rounded-full bg-spotify-green transition-all duration-200"
                        style={{ width: `${(progress / duration) * 100}%` }}
                      />
                    </div>
                    <div className="mt-0.5 flex justify-between text-[10px] text-spotify-light/60">
                      <span>{formatTime(progress)}</span>
                      <span>{formatTime(duration)}</span>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
