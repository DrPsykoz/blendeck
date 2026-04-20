"use client";

import {
  searchAdminCandidates,
  redownloadAdminTrack,
  YTMusicCandidate,
} from "@/lib/api";
import { useMutation, useQuery } from "@tanstack/react-query";
import { CheckCircle, Loader2, Music, Search, X } from "lucide-react";
import { useState } from "react";

interface TrackRechercheProps {
  trackId: string;
  artist: string;
  title: string;
  durationMs?: number;
  onSuccess?: () => void;
  onClose: () => void;
}

function formatDuration(seconds: number): string {
  if (!seconds) return "--:--";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function ScoreBadge({ score }: { score: number }) {
  const color =
    score >= 20
      ? "text-green-400 border-green-500/30 bg-green-500/10"
      : score >= 10
      ? "text-amber border-amber/30 bg-amber/10"
      : score >= 0
      ? "text-sand-400 border-deck-border bg-deck-surface"
      : "text-red-400 border-red-500/30 bg-red-500/10";
  return (
    <span
      className={`inline-flex items-center rounded px-1.5 py-0.5 text-xs font-mono border ${color}`}
    >
      {score > 0 ? "+" : ""}
      {score}
    </span>
  );
}

export default function TrackRecherche({
  trackId,
  artist,
  title,
  durationMs = 0,
  onSuccess,
  onClose,
}: TrackRechercheProps) {
  const [selectedVideoId, setSelectedVideoId] = useState<string | null>(null);

  const searchQuery = useQuery({
    queryKey: ["admin-candidates", trackId, artist, title],
    queryFn: () => searchAdminCandidates(trackId, artist, title, durationMs),
    staleTime: 60_000,
  });

  const redownloadMutation = useMutation({
    mutationFn: (videoId: string) =>
      redownloadAdminTrack(trackId, videoId, artist, title),
    onSuccess: () => {
      onSuccess?.();
    },
  });

  const candidates = searchQuery.data?.candidates ?? [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="flex max-h-[80vh] w-full max-w-2xl flex-col rounded-2xl border border-deck-border bg-deck-card shadow-2xl">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 border-b border-deck-border px-5 py-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Search className="h-4 w-4 text-amber" />
              <h2 className="font-display text-base font-semibold text-sand-50">
                Sélectionner une source
              </h2>
            </div>
            <p className="mt-0.5 truncate text-xs text-sand-400">
              {artist} — {title}
            </p>
          </div>
          <button
            onClick={onClose}
            className="shrink-0 rounded-lg p-1 text-sand-400 hover:text-sand-50"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Body */}
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {searchQuery.isLoading && (
            <div className="flex flex-col items-center justify-center gap-3 py-12">
              <Loader2 className="h-8 w-8 animate-spin text-amber" />
              <p className="text-sm text-sand-400">
                Recherche sur YouTube Music...
              </p>
            </div>
          )}

          {searchQuery.isError && (
            <p className="py-8 text-center text-sm text-red-400">
              Erreur de recherche —{" "}
              {(searchQuery.error as Error).message}
            </p>
          )}

          {!searchQuery.isLoading && candidates.length === 0 && (
            <p className="py-8 text-center text-sm text-sand-400">
              Aucun résultat trouvé.
            </p>
          )}

          <div className="space-y-2">
            {candidates.map((c: YTMusicCandidate) => {
              const isSelected = selectedVideoId === c.video_id;
              const isDownloading =
                redownloadMutation.isPending &&
                redownloadMutation.variables === c.video_id;
              const isDone =
                redownloadMutation.isSuccess &&
                redownloadMutation.variables === c.video_id;

              return (
                <button
                  key={c.video_id}
                  onClick={() => setSelectedVideoId(c.video_id)}
                  disabled={redownloadMutation.isPending}
                  className={`flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors ${
                    isSelected
                      ? "border-amber/60 bg-amber/10"
                      : "border-deck-border bg-deck-surface/40 hover:bg-deck-surface/70"
                  }`}
                >
                  {/* Thumbnail */}
                  <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-lg bg-deck-surface">
                    {c.thumbnail_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={c.thumbnail_url}
                        alt=""
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <Music className="m-auto h-6 w-6 text-sand-500" />
                    )}
                    {isDone && (
                      <div className="absolute inset-0 flex items-center justify-center rounded-lg bg-green-500/80">
                        <CheckCircle className="h-6 w-6 text-white" />
                      </div>
                    )}
                  </div>

                  {/* Info */}
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-sand-100">
                      {c.title || c.video_id}
                    </div>
                    <div className="truncate text-xs text-sand-400">
                      {c.artists || "Artiste inconnu"} ·{" "}
                      {formatDuration(c.duration_seconds)}
                    </div>
                  </div>

                  {/* Score + state */}
                  <div className="flex shrink-0 items-center gap-2">
                    <ScoreBadge score={c.score} />
                    {isDownloading && (
                      <Loader2 className="h-4 w-4 animate-spin text-amber" />
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-3 border-t border-deck-border px-5 py-3">
          {redownloadMutation.isError && (
            <p className="text-xs text-red-400">
              {(redownloadMutation.error as Error).message}
            </p>
          )}
          {redownloadMutation.isSuccess && (
            <p className="text-xs text-green-400">
              ✓ Téléchargé ({redownloadMutation.data.size_mb} MB)
            </p>
          )}
          {!redownloadMutation.isError && !redownloadMutation.isSuccess && (
            <span />
          )}

          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="rounded-lg border border-deck-border px-3 py-1.5 text-sm text-sand-300 hover:border-sand-400 hover:text-sand-50"
            >
              Fermer
            </button>
            <button
              onClick={() => {
                if (selectedVideoId)
                  redownloadMutation.mutate(selectedVideoId);
              }}
              disabled={!selectedVideoId || redownloadMutation.isPending}
              className="inline-flex items-center gap-2 rounded-lg border border-amber/40 bg-amber/10 px-3 py-1.5 text-sm text-amber hover:bg-amber/20 disabled:opacity-50"
            >
              {redownloadMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Téléchargement...
                </>
              ) : (
                "Télécharger ce résultat"
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
