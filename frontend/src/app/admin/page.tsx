"use client";

import { useAuth } from "@/app/providers";
import {
  activateAdminTrackVariant,
  clearAdminCache,
  deleteAdminTrackCache,
  fetchAdminCachedTracks,
  fetchAdminTrackAudioBlob,
  fetchAdminCacheOverview,
  validateAdminTrack,
  AdminCacheOverview,
  AdminCachedTracksList,
  AdminCachedTrackItem,
} from "@/lib/api";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Shield, Trash2, Database, RefreshCw, Play, Pause, ChevronDown, ChevronUp, Search, CheckCircle, XCircle, ChevronLeft, ChevronRight, Filter, Sparkles } from "lucide-react";
import TrackRecherche from "@/components/TrackRecherche";

function formatStorage(valueMb: number): string {
  if (valueMb >= 1024) {
    return `${(valueMb / 1024).toFixed(2)} GB`;
  }
  return `${valueMb.toFixed(2)} MB`;
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return "0:00";
  }
  const totalSeconds = Math.floor(seconds);
  const minutes = Math.floor(totalSeconds / 60);
  const remainingSeconds = totalSeconds % 60;
  return `${minutes}:${String(remainingSeconds).padStart(2, "0")}`;
}

export default function AdminPage() {
  const { isAuthenticated, isLoading, isAdmin } = useAuth();
  const router = useRouter();
  const [trackIdToDelete, setTrackIdToDelete] = useState("");
  const [trackSearch, setTrackSearch] = useState("");
  const [expandedTrackKey, setExpandedTrackKey] = useState<string | null>(null);
  const [playingTrackKey, setPlayingTrackKey] = useState<string | null>(null);
  const [searchTarget, setSearchTarget] = useState<AdminCachedTrackItem | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [filterUnvalidated, setFilterUnvalidated] = useState(false);
  const [activePlayerItem, setActivePlayerItem] = useState<AdminCachedTrackItem | null>(null);
  const [playbackTime, setPlaybackTime] = useState(0);
  const [playbackDuration, setPlaybackDuration] = useState(0);
  const ITEMS_PER_PAGE = 10;
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
    mutationFn: (scope: "tracks" | "previews" | "mixes" | "transitions" | "trimmed" | "metadata" | "all") =>
      clearAdminCache(scope),
    onSuccess: () => {
      overviewQuery.refetch();
    },
  });

  const deleteTrackMutation = useMutation({
    mutationFn: ({ trackId, source, fileName }: { trackId: string; source?: "tracks" | "previews" | "auto"; fileName?: string }) =>
      deleteAdminTrackCache(trackId, source || "auto", fileName),
    onSuccess: (_data, variables) => {
      overviewQuery.refetch();
      tracksQuery.refetch();
      if (activePlayerItem && activePlayerItem.track_id === variables.trackId && activePlayerItem.file_name === variables.fileName) {
        clearAudioSession();
      }
      setTrackIdToDelete("");
    },
  });

  const validateMutation = useMutation({
    mutationFn: ({ trackId, validated }: { trackId: string; validated: boolean }) =>
      validateAdminTrack(trackId, validated),
    onSuccess: () => {
      tracksQuery.refetch();
    },
  });

  const activateVariantMutation = useMutation({
    mutationFn: ({ trackId, fileName }: { trackId: string; fileName: string }) =>
      activateAdminTrackVariant(trackId, fileName),
    onSuccess: () => {
      tracksQuery.refetch();
    },
  });

  const trackItemKey = (item: AdminCachedTrackItem) => `${item.source}:${item.track_id}:${item.file_name}`;

  const clearAudioSession = () => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = "";
      audioRef.current = null;
    }
    if (audioUrlRef.current) {
      URL.revokeObjectURL(audioUrlRef.current);
      audioUrlRef.current = null;
    }
    setPlayingTrackKey(null);
    setActivePlayerItem(null);
    setPlaybackTime(0);
    setPlaybackDuration(0);
  };

  const seekPlayback = (nextTime: number) => {
    if (!audioRef.current) {
      return;
    }
    const duration = Number.isFinite(audioRef.current.duration) ? audioRef.current.duration : playbackDuration;
    const clampedTime = Math.max(0, Math.min(nextTime, duration || 0));
    audioRef.current.currentTime = clampedTime;
    setPlaybackTime(clampedTime);
  };

  const togglePlay = async (item: AdminCachedTrackItem) => {
    const itemKey = trackItemKey(item);
    if (playingTrackKey === itemKey && audioRef.current) {
      if (audioRef.current.paused) {
        await audioRef.current.play();
      } else {
        audioRef.current.pause();
      }
      return;
    }

    clearAudioSession();

    const blob = await fetchAdminTrackAudioBlob(item.track_id, item.source, item.file_name);
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    audioRef.current = audio;
    audioUrlRef.current = url;
    setActivePlayerItem(item);
    setPlayingTrackKey(itemKey);
    setPlaybackTime(0);
    setPlaybackDuration(0);

    audio.addEventListener("loadedmetadata", () => {
      setPlaybackDuration(Number.isFinite(audio.duration) ? audio.duration : 0);
    });

    audio.addEventListener("timeupdate", () => {
      setPlaybackTime(audio.currentTime || 0);
      if (Number.isFinite(audio.duration)) {
        setPlaybackDuration(audio.duration);
      }
    });

    audio.addEventListener("ended", () => {
      setPlayingTrackKey(null);
      setPlaybackTime(0);
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
      clearAudioSession();
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
  const groupedTracks = (() => {
    const items = tracksQuery.data?.items || [];
    const grouped: Record<string, AdminCachedTrackItem[]> = {};
    items.forEach((item) => {
      if (!grouped[item.track_id]) {
        grouped[item.track_id] = [];
      }
      grouped[item.track_id].push(item);
    });
    return Object.entries(grouped);
  })();
  const unvalidatedCount = groupedTracks.filter(([, versions]) => versions.every((version) => !version.validated)).length;
  const filteredTrackEntries = filterUnvalidated
    ? groupedTracks.filter(([, versions]) => versions.every((version) => !version.validated))
    : groupedTracks;
  const totalGroups = filteredTrackEntries.length;
  const totalPages = Math.max(1, Math.ceil(totalGroups / ITEMS_PER_PAGE));
  const page = Math.min(currentPage, totalPages);
  const pageEntries = filteredTrackEntries.slice((page - 1) * ITEMS_PER_PAGE, page * ITEMS_PER_PAGE);

  return (
    <>
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
              { key: "previews", label: "Previews", files: data.previews.files, mb: data.previews.size_mb },
              { key: "mixes", label: "Mix", files: data.mixes.files, mb: data.mixes.size_mb },
              { key: "transitions", label: "Transitions", files: data.transitions.files, mb: data.transitions.size_mb },
              { key: "trimmed", label: "Trimmed", files: data.trimmed.files, mb: data.trimmed.size_mb },
              {
                key: "total",
                label: "Total",
                files:
                  data.tracks.files +
                  data.previews.files +
                  data.mixes.files +
                  data.transitions.files +
                  data.trimmed.files +
                  data.metadata.files,
                mb: data.total.size_mb,
              },
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
                { scope: "previews", label: "Vider previews" },
                { scope: "mixes", label: "Vider mix" },
                { scope: "transitions", label: "Vider transitions" },
                { scope: "trimmed", label: "Vider trimmed" },
                { scope: "metadata", label: "Vider métadonnées" },
                { scope: "all", label: "Tout vider" },
              ].map((btn) => (
                <button
                  key={btn.scope}
                  onClick={() => clearMutation.mutate(btn.scope as "tracks" | "previews" | "mixes" | "transitions" | "trimmed" | "metadata" | "all")}
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
              <div>
                <h2 className="font-display text-lg font-semibold text-sand-50">Pistes en cache</h2>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-sand-400">
                  <span>{tracksQuery.data ? `${tracksQuery.data.returned}/${tracksQuery.data.total_files}` : "..."} fichier(s)</span>
                  <span className="inline-flex items-center gap-1 rounded-full border border-amber/30 bg-amber/10 px-2 py-0.5 text-amber">
                    <Sparkles className="h-3 w-3" />
                    {unvalidatedCount} musique(s) à valider
                  </span>
                </div>
              </div>
            </div>

            {activePlayerItem && (
              <div className="mb-4 rounded-xl border border-amber/30 bg-amber/10 p-3">
                <div className="flex flex-col gap-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-sand-50">
                        {activePlayerItem.name || activePlayerItem.track_id}
                      </div>
                      <div className="truncate text-xs text-sand-300">
                        {activePlayerItem.artist || "Artiste inconnu"} · {activePlayerItem.source === "previews" ? "Preview" : "Fichier complet"}
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        onClick={() => seekPlayback(playbackTime - 10)}
                        disabled={!audioRef.current}
                        className="rounded-md border border-deck-border px-2 py-1 text-xs text-sand-300 hover:border-sand-400 hover:text-sand-50 disabled:opacity-40"
                      >
                        -10s
                      </button>
                      <button
                        onClick={() => togglePlay(activePlayerItem).catch(() => {})}
                        className="inline-flex items-center gap-1 rounded-md border border-amber/30 bg-amber/20 px-2 py-1 text-xs text-amber hover:bg-amber/30"
                      >
                        {playingTrackKey === trackItemKey(activePlayerItem) ? (
                          <Pause className="h-3 w-3" />
                        ) : (
                          <Play className="h-3 w-3" />
                        )}
                        {playingTrackKey === trackItemKey(activePlayerItem) ? "Pause" : "Lecture"}
                      </button>
                      <button
                        onClick={() => seekPlayback(playbackTime + 10)}
                        disabled={!audioRef.current}
                        className="rounded-md border border-deck-border px-2 py-1 text-xs text-sand-300 hover:border-sand-400 hover:text-sand-50 disabled:opacity-40"
                      >
                        +10s
                      </button>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="w-10 text-xs text-sand-300">{formatTime(playbackTime)}</span>
                    <input
                      type="range"
                      min={0}
                      max={Math.max(playbackDuration, 0)}
                      step={0.1}
                      value={Math.min(playbackTime, playbackDuration || playbackTime)}
                      onChange={(e) => seekPlayback(Number(e.target.value))}
                      className="h-2 flex-1 cursor-pointer accent-amber"
                    />
                    <span className="w-10 text-right text-xs text-sand-300">{formatTime(playbackDuration)}</span>
                  </div>
                </div>
              </div>
            )}

            <div className="mb-3 flex flex-col gap-2 sm:flex-row">
              <input
                type="text"
                value={trackSearch}
                onChange={(e) => { setTrackSearch(e.target.value); setCurrentPage(1); }}
                placeholder="Rechercher par ID, titre, artiste"
                className="flex-1 rounded-lg border border-deck-border bg-deck-surface px-3 py-2 text-sm text-sand-100 outline-none focus:border-amber"
              />
              <button
                onClick={() => { setFilterUnvalidated((v) => !v); setCurrentPage(1); }}
                className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm ${
                  filterUnvalidated
                    ? "border-amber bg-amber/20 text-amber"
                    : "border-deck-border bg-deck-surface text-sand-300 hover:border-sand-400 hover:text-sand-50"
                }`}
              >
                <Filter className="h-4 w-4" />
                Non validées
              </button>
            </div>

            {tracksQuery.isLoading && (
              <p className="text-sm text-sand-300">Chargement des pistes...</p>
            )}

            {tracksQuery.error && (
              <p className="text-sm text-red-400">Erreur: {(tracksQuery.error as Error).message}</p>
            )}

            <div className="space-y-3">
              <>
                    {pageEntries.map(([trackId, versions]) => {
                      const trackKey = `track:${trackId}`;
                      const isExpanded = expandedTrackKey === trackKey;
                      const firstItem = versions[0];
                      const isValidated = versions.some((v) => v.validated);

                      return (
                        <div key={trackKey} className="rounded-lg border border-deck-border bg-deck-surface/40 overflow-hidden">
                          <button
                            onClick={() => setExpandedTrackKey(isExpanded ? null : trackKey)}
                            className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left hover:bg-deck-surface/60"
                          >
                            <div className="flex min-w-0 flex-1 items-center gap-2">
                              {isValidated ? (
                                <CheckCircle className="h-4 w-4 shrink-0 text-green-400" />
                              ) : (
                                <XCircle className="h-4 w-4 shrink-0 text-sand-500" />
                              )}
                              <div className="min-w-0">
                                <div className="truncate text-sm font-medium text-sand-100">
                                  {firstItem.name || trackId}
                                </div>
                                <div className="truncate text-xs text-sand-400">
                                  {firstItem.artist || "Artiste inconnu"} · {versions.length} version{versions.length > 1 ? "s" : ""}
                                </div>
                              </div>
                            </div>
                            {isExpanded ? (
                              <ChevronUp className="h-4 w-4 shrink-0 text-sand-400" />
                            ) : (
                              <ChevronDown className="h-4 w-4 shrink-0 text-sand-400" />
                            )}
                          </button>

                          {isExpanded && (
                            <div className="border-t border-deck-border px-3 py-2 space-y-3">
                              <div className="text-xs text-sand-300">
                                <div>ID: <span className="font-mono text-sand-400">{trackId}</span></div>
                              </div>

                              {/* Validation globale du track */}
                              <div className="flex items-center gap-2">
                                {isValidated ? (
                                  <button
                                    onClick={() => validateMutation.mutate({ trackId, validated: false })}
                                    disabled={validateMutation.isPending}
                                    className="inline-flex items-center gap-1 rounded-md border border-green-500/40 bg-green-500/10 px-2 py-1 text-xs text-green-400 hover:bg-green-500/20 disabled:opacity-60"
                                  >
                                    <CheckCircle className="h-3 w-3" />
                                    Validée — cliquer pour annuler
                                  </button>
                                ) : (
                                  <button
                                    onClick={() => validateMutation.mutate({ trackId, validated: true })}
                                    disabled={validateMutation.isPending}
                                    className="inline-flex items-center gap-1 rounded-md border border-amber/30 bg-amber/10 px-2 py-1 text-xs text-amber hover:bg-amber/20 disabled:opacity-60"
                                  >
                                    <CheckCircle className="h-3 w-3" />
                                    Valider
                                  </button>
                                )}
                              </div>

                              {/* Versions (preview and/or tracks) */}
                              <div className="space-y-2">
                                {versions.map((item) => {
                                  const itemKey = trackItemKey(item);
                                  const isPlaying = playingTrackKey === itemKey && !!audioRef.current && !audioRef.current.paused;
                                  const sourceLabel = item.source === "previews" ? "📍 Preview" : "🎵 Fichier complet";

                                  return (
                                    <div key={itemKey} className="rounded-lg bg-deck-surface/50 p-2 border border-deck-border/50">
                                      <div className="flex items-center justify-between gap-2 mb-2">
                                        <div className="flex flex-wrap items-center gap-1 text-xs text-sand-300">
                                          <span className="font-medium">{sourceLabel}</span>
                                          <span className="mx-1 text-sand-400">·</span>
                                          <span className="text-sand-400">{formatStorage(item.size_mb)}</span>
                                          <span className="mx-1 text-sand-400">·</span>
                                          <span className="text-sand-500">{item.file_name}</span>
                                          {item.source === "tracks" && item.variant_id && (
                                            <span className="rounded-full border border-amber/30 bg-amber/10 px-1.5 py-0.5 text-[10px] text-amber">
                                              Alternative
                                            </span>
                                          )}
                                          {item.source === "tracks" && item.is_active && (
                                            <span className="rounded-full border border-green-500/30 bg-green-500/10 px-1.5 py-0.5 text-[10px] text-green-400">
                                              Utilisée pour le mix
                                            </span>
                                          )}
                                        </div>
                                      </div>
                                      <div className="flex flex-wrap gap-2">
                                        <button
                                          onClick={() => togglePlay(item).catch(() => {})}
                                          className="inline-flex items-center gap-1 rounded-md border border-amber/30 bg-amber/10 px-2 py-1 text-xs text-amber hover:bg-amber/20"
                                        >
                                          {isPlaying ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />}
                                          {isPlaying ? "Pause" : "Écouter"}
                                        </button>
                                        {item.source === "tracks" && (
                                          <button
                                            onClick={() => setSearchTarget(item)}
                                            className="inline-flex items-center gap-1 rounded-md border border-deck-border bg-deck-surface px-2 py-1 text-xs text-sand-300 hover:bg-deck-surface/70"
                                          >
                                            <Search className="h-3 w-3" />
                                            Rechercher
                                          </button>
                                        )}
                                        {item.source === "tracks" && !item.is_active && (
                                          <button
                                            onClick={() => activateVariantMutation.mutate({ trackId: item.track_id, fileName: item.file_name })}
                                            disabled={activateVariantMutation.isPending}
                                            className="inline-flex items-center gap-1 rounded-md border border-green-500/30 bg-green-500/10 px-2 py-1 text-xs text-green-400 hover:bg-green-500/20 disabled:opacity-60"
                                          >
                                            <CheckCircle className="h-3 w-3" />
                                            Utiliser
                                          </button>
                                        )}
                                        <button
                                          onClick={() => {
                                            setTrackIdToDelete(item.track_id);
                                            deleteTrackMutation.mutate({ trackId: item.track_id, source: item.source, fileName: item.file_name });
                                          }}
                                          className="inline-flex items-center gap-1 rounded-md border border-red-500/30 bg-red-500/10 px-2 py-1 text-xs text-red-300 hover:bg-red-500/15"
                                        >
                                          <Trash2 className="h-3 w-3" />
                                          Supprimer
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
                    })}

                    {pageEntries.length === 0 && (
                      <p className="text-xs text-sand-500">
                        {filterUnvalidated ? "Toutes les pistes sont validées." : "Aucune piste en cache."}
                      </p>
                    )}

                    {/* Pagination */}
                    {totalGroups > ITEMS_PER_PAGE && (
                      <div className="mt-4 flex items-center justify-between gap-2">
                        <span className="text-xs text-sand-400">
                          Page {page}/{totalPages} · {totalGroups} piste(s)
                        </span>
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                            disabled={page <= 1}
                            className="inline-flex items-center gap-1 rounded-md border border-deck-border px-2 py-1 text-xs text-sand-300 hover:border-sand-400 hover:text-sand-50 disabled:opacity-40"
                          >
                            <ChevronLeft className="h-3 w-3" />
                            Préc.
                          </button>
                          <button
                            onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                            disabled={page >= totalPages}
                            className="inline-flex items-center gap-1 rounded-md border border-deck-border px-2 py-1 text-xs text-sand-300 hover:border-sand-400 hover:text-sand-50 disabled:opacity-40"
                          >
                            Suiv.
                            <ChevronRight className="h-3 w-3" />
                          </button>
                        </div>
                      </div>
                    )}
              </>
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

    {/* Modal de recherche YouTube Music */}
    {searchTarget && (
      <TrackRecherche
        trackId={searchTarget.track_id}
        artist={searchTarget.artist || ""}
        title={searchTarget.name || searchTarget.track_id}
        onSuccess={() => {
          tracksQuery.refetch();
          setSearchTarget(null);
        }}
        onClose={() => setSearchTarget(null)}
      />
    )}
  </>
  );
}
