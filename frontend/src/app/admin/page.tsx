"use client";

import { useAuth } from "@/app/providers";
import {
  clearAdminCache,
  deleteAdminTrackCache,
  fetchAdminCachedTracks,
  fetchAdminTrackAudioBlob,
  fetchAdminCacheOverview,
  AdminCacheOverview,
  AdminCachedTracksList,
} from "@/lib/api";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Shield, Trash2, Database, RefreshCw, Play, Pause, ChevronDown, ChevronUp } from "lucide-react";

function formatStorage(valueMb: number): string {
  if (valueMb >= 1024) {
    return `${(valueMb / 1024).toFixed(2)} GB`;
  }
  return `${valueMb.toFixed(2)} MB`;
}

export default function AdminPage() {
  const { isAuthenticated, isLoading, isAdmin } = useAuth();
  const router = useRouter();
  const [trackIdToDelete, setTrackIdToDelete] = useState("");
  const [trackSearch, setTrackSearch] = useState("");
  const [expandedTrackKey, setExpandedTrackKey] = useState<string | null>(null);
  const [playingTrackKey, setPlayingTrackKey] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioUrlRef = useRef<string | null>(null);

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.replace("/login");
    }
  }, [isAuthenticated, isLoading, router]);

  const overviewQuery = useQuery<AdminCacheOverview>({
    queryKey: ["admin-cache-overview"],
    queryFn: fetchAdminCacheOverview,
    enabled: isAuthenticated && isAdmin,
  });

  const tracksQuery = useQuery<AdminCachedTracksList>({
    queryKey: ["admin-cached-tracks", trackSearch],
    queryFn: () => fetchAdminCachedTracks(trackSearch, 300),
    enabled: isAuthenticated && isAdmin,
  });

  const clearMutation = useMutation({
    mutationFn: (scope: "tracks" | "mixes" | "transitions" | "metadata" | "all") =>
      clearAdminCache(scope),
    onSuccess: () => {
      overviewQuery.refetch();
    },
  });

  const deleteTrackMutation = useMutation({
    mutationFn: ({ trackId, source }: { trackId: string; source?: "tracks" | "previews" | "auto" }) =>
      deleteAdminTrackCache(trackId, source || "auto"),
    onSuccess: () => {
      overviewQuery.refetch();
      tracksQuery.refetch();
      if (playingTrackKey && playingTrackKey.endsWith(`:${trackIdToDelete.trim()}`)) {
        if (audioRef.current) {
          audioRef.current.pause();
          audioRef.current = null;
        }
        if (audioUrlRef.current) {
          URL.revokeObjectURL(audioUrlRef.current);
          audioUrlRef.current = null;
        }
        setPlayingTrackKey(null);
      }
      setTrackIdToDelete("");
    },
  });

  const trackItemKey = (trackId: string, source: "tracks" | "previews") => `${source}:${trackId}`;

  const togglePlay = async (trackId: string, source: "tracks" | "previews") => {
    const itemKey = trackItemKey(trackId, source);
    if (playingTrackKey === itemKey && audioRef.current) {
      if (audioRef.current.paused) {
        await audioRef.current.play();
      } else {
        audioRef.current.pause();
      }
      return;
    }

    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    if (audioUrlRef.current) {
      URL.revokeObjectURL(audioUrlRef.current);
      audioUrlRef.current = null;
    }

    const blob = await fetchAdminTrackAudioBlob(trackId, source);
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    audioRef.current = audio;
    audioUrlRef.current = url;
    setPlayingTrackKey(itemKey);

    audio.addEventListener("ended", () => {
      setPlayingTrackKey(null);
      if (audioUrlRef.current) {
        URL.revokeObjectURL(audioUrlRef.current);
        audioUrlRef.current = null;
      }
      audioRef.current = null;
    });

    audio.addEventListener("pause", () => {
      setPlayingTrackKey(null);
    });

    audio.addEventListener("play", () => {
      setPlayingTrackKey(itemKey);
    });

    await audio.play();
  };

  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
      if (audioUrlRef.current) {
        URL.revokeObjectURL(audioUrlRef.current);
        audioUrlRef.current = null;
      }
    };
  }, []);

  if (isLoading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-amber border-t-transparent" />
      </div>
    );
  }

  if (!isAuthenticated) return null;

  if (!isAdmin) {
    return (
      <div className="mx-auto max-w-2xl rounded-xl border border-red-500/20 bg-red-500/5 p-6 text-center">
        <h1 className="font-display text-2xl font-bold text-red-400">Accès refusé</h1>
        <p className="mt-2 text-sm text-sand-300">Cette page est réservée à l&apos;administrateur.</p>
        <button
          onClick={() => router.push("/")}
          className="mt-5 inline-flex items-center gap-2 rounded-lg border border-deck-border px-3 py-2 text-sm text-sand-300 hover:border-sand-400 hover:text-sand-50"
        >
          <ArrowLeft className="h-4 w-4" />
          Retour à l&apos;accueil
        </button>
      </div>
    );
  }

  const data = overviewQuery.data;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 font-display text-3xl font-bold tracking-tight text-sand-50">
            <Shield className="h-7 w-7 text-amber" />
            Administration
          </h1>
          <p className="mt-1 text-sm text-sand-300">
            Gestion du cache local du backend
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => router.push("/")}
            className="inline-flex items-center gap-2 rounded-lg border border-deck-border px-3 py-2 text-sm text-sand-300 hover:border-sand-400 hover:text-sand-50"
          >
            <ArrowLeft className="h-4 w-4" />
            Accueil
          </button>
          <button
            onClick={() => overviewQuery.refetch()}
            className="inline-flex items-center gap-2 rounded-lg border border-amber/40 bg-amber/10 px-3 py-2 text-sm text-amber hover:bg-amber/20"
          >
            <RefreshCw className="h-4 w-4" />
            Rafraîchir
          </button>
          <button
            onClick={() => tracksQuery.refetch()}
            className="inline-flex items-center gap-2 rounded-lg border border-amber/40 bg-amber/10 px-3 py-2 text-sm text-amber hover:bg-amber/20"
          >
            <RefreshCw className="h-4 w-4" />
            Rafraîchir pistes
          </button>
        </div>
      </div>

      {overviewQuery.isLoading && (
        <div className="rounded-xl border border-deck-border bg-deck-card p-5 text-sm text-sand-300">
          Chargement de l&apos;état du cache...
        </div>
      )}

      {overviewQuery.error && (
        <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-5 text-sm text-red-400">
          Erreur: {(overviewQuery.error as Error).message}
        </div>
      )}

      {data && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { key: "tracks", label: "Pistes", files: data.tracks.files, mb: data.tracks.size_mb },
              { key: "mixes", label: "Mix", files: data.mixes.files, mb: data.mixes.size_mb },
              { key: "transitions", label: "Transitions", files: data.transitions.files, mb: data.transitions.size_mb },
              { key: "total", label: "Total", files: data.tracks.files + data.mixes.files + data.transitions.files + data.metadata.files, mb: data.total.size_mb },
            ].map((item) => (
              <div key={item.key} className="rounded-xl border border-deck-border bg-deck-card px-4 py-3">
                <p className="text-xs uppercase tracking-wide text-sand-400">{item.label}</p>
                <p className="mt-1 font-display text-2xl font-bold text-sand-50">{item.files}</p>
                <p className="text-xs text-sand-300">{formatStorage(item.mb)}</p>
              </div>
            ))}
          </div>

          <div className="rounded-xl border border-deck-border bg-deck-card p-4">
            <h2 className="mb-3 flex items-center gap-2 font-display text-lg font-semibold text-sand-50">
              <Database className="h-4 w-4 text-amber" />
              Actions cache
            </h2>
            <div className="flex flex-wrap gap-2">
              {[
                { scope: "tracks", label: "Vider pistes" },
                { scope: "mixes", label: "Vider mix" },
                { scope: "transitions", label: "Vider transitions" },
                { scope: "metadata", label: "Vider métadonnées" },
                { scope: "all", label: "Tout vider" },
              ].map((btn) => (
                <button
                  key={btn.scope}
                  onClick={() => clearMutation.mutate(btn.scope as "tracks" | "mixes" | "transitions" | "metadata" | "all")}
                  disabled={clearMutation.isPending}
                  className="inline-flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300 hover:bg-red-500/15 disabled:opacity-60"
                >
                  <Trash2 className="h-4 w-4" />
                  {btn.label}
                </button>
              ))}
            </div>
            {clearMutation.data && (
              <p className="mt-3 text-xs text-sand-300">
                Cache nettoyé ({clearMutation.data.scope}) - espace libéré: {formatStorage(clearMutation.data.total.freed_mb)}
              </p>
            )}
          </div>

          <div className="rounded-xl border border-deck-border bg-deck-card p-4">
            <h2 className="mb-3 font-display text-lg font-semibold text-sand-50">Supprimer une piste du cache</h2>
            <div className="flex flex-col gap-2 sm:flex-row">
              <input
                type="text"
                value={trackIdToDelete}
                onChange={(e) => setTrackIdToDelete(e.target.value)}
                placeholder="Spotify track ID"
                className="w-full rounded-lg border border-deck-border bg-deck-surface px-3 py-2 text-sm text-sand-100 outline-none focus:border-amber"
              />
              <button
                onClick={() => deleteTrackMutation.mutate({ trackId: trackIdToDelete.trim(), source: "auto" })}
                disabled={!trackIdToDelete.trim() || deleteTrackMutation.isPending}
                className="inline-flex items-center justify-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300 hover:bg-red-500/15 disabled:opacity-60"
              >
                <Trash2 className="h-4 w-4" />
                Supprimer
              </button>
            </div>
            {deleteTrackMutation.data && (
              <p className="mt-3 text-xs text-sand-300">
                {deleteTrackMutation.data.deleted
                  ? `Supprimé: ${deleteTrackMutation.data.track_id} (${formatStorage(deleteTrackMutation.data.freed_mb || 0)})`
                  : `Aucun fichier trouvé pour ${deleteTrackMutation.data.track_id}`}
              </p>
            )}
          </div>

          <div className="rounded-xl border border-deck-border bg-deck-card p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <h2 className="font-display text-lg font-semibold text-sand-50">Pistes en cache</h2>
              <span className="text-xs text-sand-400">
                {tracksQuery.data ? `${tracksQuery.data.returned}/${tracksQuery.data.total_files}` : "..."} piste(s)
              </span>
            </div>
            <div className="mb-3">
              <input
                type="text"
                value={trackSearch}
                onChange={(e) => setTrackSearch(e.target.value)}
                placeholder="Rechercher par ID, titre, artiste"
                className="w-full rounded-lg border border-deck-border bg-deck-surface px-3 py-2 text-sm text-sand-100 outline-none focus:border-amber"
              />
            </div>

            {tracksQuery.isLoading && (
              <p className="text-sm text-sand-300">Chargement des pistes...</p>
            )}

            {tracksQuery.error && (
              <p className="text-sm text-red-400">Erreur: {(tracksQuery.error as Error).message}</p>
            )}

            <div className="space-y-3">
              {(() => {
                // Regroup items by track_id
                const items = tracksQuery.data?.items || [];
                const grouped: Record<string, typeof items> = {};
                items.forEach((item) => {
                  if (!grouped[item.track_id]) {
                    grouped[item.track_id] = [];
                  }
                  grouped[item.track_id].push(item);
                });

                return Object.entries(grouped).map(([trackId, versions]) => {
                  const trackKey = `track:${trackId}`;
                  const isExpanded = expandedTrackKey === trackKey;
                  const firstItem = versions[0]; // Use first item for title/artist
                  
                  return (
                    <div key={trackKey} className="rounded-lg border border-deck-border bg-deck-surface/40 overflow-hidden">
                      <button
                        onClick={() => setExpandedTrackKey(isExpanded ? null : trackKey)}
                        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left hover:bg-deck-surface/60"
                      >
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium text-sand-100">
                            {firstItem.name || trackId}
                          </div>
                          <div className="truncate text-xs text-sand-400">
                            {firstItem.artist || "Artiste inconnu"} · {versions.length} version{versions.length > 1 ? "s" : ""}
                          </div>
                        </div>
                        {isExpanded ? (
                          <ChevronUp className="h-4 w-4 text-sand-400" />
                        ) : (
                          <ChevronDown className="h-4 w-4 text-sand-400" />
                        )}
                      </button>

                      {isExpanded && (
                        <div className="border-t border-deck-border px-3 py-2 space-y-3">
                          <div className="text-xs text-sand-300">
                            <div>ID: <span className="font-mono text-sand-400">{trackId}</span></div>
                          </div>

                          {/* Versions (preview and/or tracks) */}
                          <div className="space-y-2">
                            {versions.map((item) => {
                              const itemKey = trackItemKey(item.track_id, item.source);
                              const isPlaying = playingTrackKey === itemKey && !!audioRef.current && !audioRef.current.paused;
                              const sourceLabel = item.source === "previews" ? "📍 Preview" : "🎵 Fichier complet";

                              return (
                                <div key={itemKey} className="rounded-lg bg-deck-surface/50 p-2 border border-deck-border/50">
                                  <div className="flex items-center justify-between gap-2 mb-2">
                                    <div className="text-xs text-sand-300">
                                      <span className="font-medium">{sourceLabel}</span>
                                      <span className="mx-1 text-sand-400">·</span>
                                      <span className="text-sand-400">{formatStorage(item.size_mb)}</span>
                                      <span className="mx-1 text-sand-400">·</span>
                                      <span className="text-sand-500">{item.file_name}</span>
                                    </div>
                                  </div>
                                  <div className="flex flex-wrap gap-2">
                                    <button
                                      onClick={() => togglePlay(item.track_id, item.source).catch(() => {})}
                                      className="inline-flex items-center gap-1 rounded-md border border-amber/30 bg-amber/10 px-2 py-1 text-xs text-amber hover:bg-amber/20"
                                    >
                                      {isPlaying ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />}
                                      {isPlaying ? "Pause" : "Écouter"}
                                    </button>
                                    <button
                                      onClick={() => {
                                        setTrackIdToDelete(item.track_id);
                                        deleteTrackMutation.mutate({ trackId: item.track_id, source: item.source });
                                      }}
                                      className="inline-flex items-center gap-1 rounded-md border border-red-500/30 bg-red-500/10 px-2 py-1 text-xs text-red-300 hover:bg-red-500/15"
                                    >
                                      <Trash2 className="h-3 w-3" />
                                      Invalider
                                    </button>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                });
              })()}
              {tracksQuery.data && tracksQuery.data.items.length === 0 && (
                <p className="text-xs text-sand-500">Aucune piste en cache.</p>
              )}
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            {[
              { title: "Tracks récents", section: data.tracks },
              { title: "Mixes récents", section: data.mixes },
              { title: "Transitions récentes", section: data.transitions },
            ].map((block) => (
              <div key={block.title} className="rounded-xl border border-deck-border bg-deck-card p-4">
                <h3 className="mb-2 font-medium text-sand-50">{block.title}</h3>
                <div className="space-y-1.5 text-xs text-sand-300">
                  {(block.section.recent_files || []).slice(0, 8).map((f) => (
                    <div key={f.path} className="truncate">
                      {f.name} - {formatStorage(f.size_mb)}
                    </div>
                  ))}
                  {(!block.section.recent_files || block.section.recent_files.length === 0) && (
                    <p className="text-sand-500">Aucun fichier</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
