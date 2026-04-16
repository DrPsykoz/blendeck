"use client";

import { useAuth } from "@/app/providers";
import { useMutation } from "@tanstack/react-query";
import {
  analyzePlaylist,
  generateSet,
  Track,
  TransitionScore,
  GeneratedSet,
  AnalysisProgress as AnalysisProgressData,
} from "@/lib/api";
import { useRouter, useParams } from "next/navigation";
import { useEffect, useState, useMemo, useCallback, useRef } from "react";
import {
  ArrowLeft,
  ArrowUpDown,
  Music,
  Zap,
  Disc3,
  Smile,
  Volume2,
  Clock,
  Calendar,
} from "lucide-react";
import TrackTable from "@/components/TrackTable";
import EnergyChart from "@/components/EnergyChart";
import SetGeneratorPanel from "@/components/SetGeneratorPanel";
import ExportMenu from "@/components/ExportMenu";
import MixHistory from "@/components/MixHistory";
import AnalysisProgress from "@/components/AnalysisProgress";
import SpotifyPlayer, { SpotifyPlayerHandle } from "@/components/SpotifyPlayer";

type SortKey = "bpm" | "energy" | "key" | "danceability" | "valence" | "year" | "default";

export default function PlaylistPage() {
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const router = useRouter();
  const params = useParams();
  const playlistId = params.id as string;

  const [sortedTracks, setSortedTracks] = useState<Track[]>([]);
  const [activeSort, setActiveSort] = useState<SortKey>("default");
  const [sortAsc, setSortAsc] = useState(true);
  const [transitions, setTransitions] = useState<TransitionScore[]>([]);
  const [generatedSet, setGeneratedSet] = useState<GeneratedSet | null>(null);
  const [currentSpotifyUri, setCurrentSpotifyUri] = useState<string | null>(null);
  const playerRef = useRef<SpotifyPlayerHandle | null>(null);

  // Analysis SSE state
  const [tracks, setTracks] = useState<Track[] | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [analysisTotal, setAnalysisTotal] = useState(0);
  const [analysisNeed, setAnalysisNeed] = useState(0);
  const [analysisCached, setAnalysisCached] = useState(0);
  const [analysisEvents, setAnalysisEvents] = useState<AnalysisProgressData[]>([]);
  const [analysisComplete, setAnalysisComplete] = useState(false);
  const abortRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      router.replace("/login");
    }
  }, [authLoading, isAuthenticated, router]);

  // Start SSE analysis when authenticated
  const startAnalysis = useCallback(() => {
    if (!isAuthenticated || !playlistId) return;

    // Clean up previous
    if (abortRef.current) abortRef.current();

    setIsLoading(true);
    setError(null);
    setAnalysisEvents([]);
    setAnalysisComplete(false);

    const abort = analyzePlaylist(playlistId, {
      onStart: (data) => {
        setAnalysisTotal(data.total);
        setAnalysisNeed(data.need_analysis);
        setAnalysisCached(data.cached);
      },
      onProgress: (data) => {
        setAnalysisEvents((prev) => {
          // Replace "analyzing" event for same track, or append
          const filtered = prev.filter(
            (e) => !(e.track_id === data.track_id && e.status === "analyzing"),
          );
          return [...filtered, data];
        });
      },
      onComplete: (completedTracks) => {
        setTracks(completedTracks);
        setSortedTracks(completedTracks);
        setIsLoading(false);
        setAnalysisComplete(true);
        setActiveSort("default");
      },
      onError: (message) => {
        setError(new Error(message));
        setIsLoading(false);
      },
    });

    abortRef.current = abort;
  }, [isAuthenticated, playlistId]);

  useEffect(() => {
    startAnalysis();
    return () => {
      if (abortRef.current) abortRef.current();
    };
  }, [startAnalysis]);

  const generateMutation = useMutation({
    mutationFn: (params: Parameters<typeof generateSet>[1]) =>
      generateSet(playlistId, params),
    onSuccess: (data: GeneratedSet) => {
      setGeneratedSet(data);
      setSortedTracks(data.tracks);
      setTransitions(data.transitions);
      setActiveSort("default");
    },
  });

  // Stats
  const stats = useMemo(() => {
    if (!sortedTracks.length) return null;
    const withFeatures = sortedTracks.filter((t) => t.audio_features);
    if (!withFeatures.length) return null;

    const avgBpm = withFeatures.reduce((s, t) => s + t.audio_features!.tempo, 0) / withFeatures.length;
    const avgEnergy = withFeatures.reduce((s, t) => s + t.audio_features!.energy, 0) / withFeatures.length;
    const avgDance = withFeatures.reduce((s, t) => s + t.audio_features!.danceability, 0) / withFeatures.length;
    const totalDuration = sortedTracks.reduce((s, t) => s + t.duration_ms, 0);

    return { avgBpm, avgEnergy, avgDance, totalDuration, count: sortedTracks.length };
  }, [sortedTracks]);

  // Sort handlers
  const handleSort = (key: SortKey) => {
    if (!tracks) return;

    if (key === "default") {
      setSortedTracks([...tracks]);
      setActiveSort("default");
      setTransitions([]);
      setGeneratedSet(null);
      return;
    }

    const asc = activeSort === key ? !sortAsc : true;
    setSortAsc(asc);
    setActiveSort(key);
    setGeneratedSet(null);
    setTransitions([]);

    const sorted = [...sortedTracks].sort((a, b) => {
      const afA = a.audio_features;
      const afB = b.audio_features;

      let valA: number, valB: number;
      switch (key) {
        case "year":
          valA = a.release_year ?? 0;
          valB = b.release_year ?? 0;
          break;
        case "key":
          valA = a.camelot ? a.camelot.number * 10 + (a.camelot.letter === "B" ? 1 : 0) : 999;
          valB = b.camelot ? b.camelot.number * 10 + (b.camelot.letter === "B" ? 1 : 0) : 999;
          break;
        default:
          if (!afA || !afB) return 0;
          switch (key) {
            case "bpm": valA = afA.tempo; valB = afB.tempo; break;
            case "energy": valA = afA.energy; valB = afB.energy; break;
            case "danceability": valA = afA.danceability; valB = afB.danceability; break;
            case "valence": valA = afA.valence; valB = afB.valence; break;
            default: return 0;
          }
      }
      return asc ? valA - valB : valB - valA;
    });

    setSortedTracks(sorted);
  };

  const handleReorder = (newTracks: Track[]) => {
    setSortedTracks(newTracks);
    setActiveSort("default");
    setGeneratedSet(null);
    setTransitions([]);
  };

  const handleGenerate = (params: Parameters<typeof generateSet>[1]) => {
    generateMutation.mutate(params);
  };

  const formatTotalDuration = (ms: number) => {
    const hours = Math.floor(ms / 3600000);
    const mins = Math.floor((ms % 3600000) / 60000);
    if (hours > 0) return `${hours}h ${mins}min`;
    return `${mins}min`;
  };

  if (authLoading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <div className="text-center">
          <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-2 border-spotify-green border-t-transparent" />
          <p className="text-spotify-light">Connexion...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-red-400">
        Erreur: {(error as Error).message}
      </div>
    );
  }

  // Show analysis progress while loading (even before tracks are ready)
  if (isLoading) {
    return (
      <div className="mx-auto max-w-2xl py-12">
        <div className="mb-6 flex items-center gap-4">
          <button
            onClick={() => router.push("/")}
            className="rounded-lg border border-spotify-gray p-2 transition-colors hover:border-white"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div>
            <h1 className="text-2xl font-bold">Analyse de playlist</h1>
            {analysisTotal > 0 && (
              <p className="text-sm text-spotify-light">{analysisTotal} morceaux détectés</p>
            )}
          </div>
        </div>

        {analysisNeed > 0 ? (
          <AnalysisProgress
            total={analysisTotal}
            needAnalysis={analysisNeed}
            cached={analysisCached}
            events={analysisEvents}
            isComplete={false}
          />
        ) : (
          <div className="flex items-center justify-center py-12">
            <div className="text-center">
              <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-2 border-spotify-green border-t-transparent" />
              <p className="text-spotify-light">Chargement des morceaux...</p>
            </div>
          </div>
        )}
      </div>
    );
  }

  if (!tracks) return null;

  const sortButtons: { key: SortKey; label: string; icon: typeof Music }[] = [
    { key: "bpm", label: "BPM", icon: Disc3 },
    { key: "key", label: "Tonalité", icon: Music },
    { key: "energy", label: "Énergie", icon: Zap },
    { key: "danceability", label: "Dance", icon: Smile },
    { key: "valence", label: "Mood", icon: Volume2 },
    { key: "year", label: "Année", icon: Calendar },
  ];

  return (
    <div>
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button
            onClick={() => router.push("/")}
            className="rounded-lg border border-spotify-gray p-2 transition-colors hover:border-white"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div>
            <h1 className="text-2xl font-bold">Analyse de playlist</h1>
            <p className="text-sm text-spotify-light">{tracks.length} morceaux chargés</p>
          </div>
        </div>
        <ExportMenu
          tracks={sortedTracks}
          transitions={transitions}
          playlistId={playlistId}
          playlistName="Playlist"
        />
      </div>

      {/* Stats */}
      {stats && (
        <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-5">
          {[
            { label: "Morceaux", value: stats.count, icon: Music },
            { label: "BPM moyen", value: Math.round(stats.avgBpm), icon: Disc3 },
            { label: "Énergie moy.", value: `${(stats.avgEnergy * 100).toFixed(0)}%`, icon: Zap },
            { label: "Dance moy.", value: `${(stats.avgDance * 100).toFixed(0)}%`, icon: Smile },
            { label: "Durée totale", value: formatTotalDuration(stats.totalDuration), icon: Clock },
          ].map((s) => (
            <div
              key={s.label}
              className="flex items-center gap-3 rounded-lg border border-spotify-gray bg-spotify-gray/30 px-4 py-3"
            >
              <s.icon className="h-5 w-5 text-spotify-green" />
              <div>
                <div className="text-lg font-bold">{s.value}</div>
                <div className="text-xs text-spotify-light">{s.label}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Sort buttons */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <span className="mr-2 flex items-center gap-1 text-sm text-spotify-light">
          <ArrowUpDown className="h-4 w-4" />
          Trier par:
        </span>
        {sortButtons.map((btn) => (
          <button
            key={btn.key}
            onClick={() => handleSort(btn.key)}
            className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
              activeSort === btn.key
                ? "border-spotify-green bg-spotify-green/10 text-spotify-green"
                : "border-spotify-gray text-spotify-light hover:border-white hover:text-white"
            }`}
          >
            <btn.icon className="h-3 w-3" />
            {btn.label}
            {activeSort === btn.key && (
              <span className="ml-0.5">{sortAsc ? "↑" : "↓"}</span>
            )}
          </button>
        ))}
        {activeSort !== "default" && (
          <button
            onClick={() => handleSort("default")}
            className="ml-1 text-xs text-spotify-light underline hover:text-white"
          >
            Réinitialiser
          </button>
        )}
      </div>

      {/* Main content: 2 columns on large screens */}
      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="space-y-4">
          {/* Energy chart */}
          <EnergyChart tracks={sortedTracks} transitions={transitions} />

          {/* Generated set score banner */}
          {generatedSet && (
            <div className="flex items-center justify-between rounded-lg border border-spotify-green/30 bg-spotify-green/10 px-4 py-3">
              <div>
                <span className="text-sm font-semibold text-spotify-green">
                  Set DJ généré
                </span>
                <span className="ml-2 text-xs text-spotify-light">
                  Score global: {(generatedSet.total_score / Math.max(generatedSet.transitions.length, 1) * 100).toFixed(1)}%
                </span>
              </div>
              <span className="text-xs text-spotify-light">
                {generatedSet.transitions.filter((t) => t.total_score >= 0.8).length}/
                {generatedSet.transitions.length} transitions fluides
              </span>
            </div>
          )}

          {/* Track table */}
          <TrackTable
            tracks={sortedTracks}
            transitions={transitions}
            onReorder={handleReorder}
            currentSpotifyUri={currentSpotifyUri}
            onPlaySpotify={(uri) => playerRef.current?.playFromTrack(uri)}
          />
        </div>

        {/* Sidebar: Set generator */}
        <div className="lg:sticky lg:top-4 lg:self-start">
          <SetGeneratorPanel
            onGenerate={handleGenerate}
            isLoading={generateMutation.isPending}
          />
          <MixHistory playlistId={playlistId} />
        </div>
      </div>

      {/* Spotify Player - fixed bottom bar */}
      <SpotifyPlayer
        ref={playerRef}
        tracks={sortedTracks}
        onTrackChange={setCurrentSpotifyUri}
      />

      {/* Bottom spacer for fixed player */}
      <div className="h-20" />
    </div>
  );
}
