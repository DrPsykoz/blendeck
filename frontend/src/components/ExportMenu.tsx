"use client";

import { useState, useRef, useEffect } from "react";
import { Track, TransitionScore, exportNewPlaylist, exportReorder, exportFile, generateMix, downloadMix, MixProgress, TransitionConfig } from "@/lib/api";
import { Download, ListPlus, ArrowUpDown, FileDown, Loader2, Check, Music } from "lucide-react";

interface ExportMenuProps {
  tracks: Track[];
  transitions: TransitionScore[];
  playlistId: string;
  playlistName: string;
  transitionStyle?: string;
  crossfade?: number;
  targetDuration?: number;
  onTransitionSettingsChange?: (style: string, duration: number, targetDuration: number) => void;
}

export default function ExportMenu({
  tracks,
  transitions,
  playlistId,
  playlistName,
  transitionStyle: externalStyle,
  crossfade: externalCrossfade,
  targetDuration: externalTargetDuration,
  onTransitionSettingsChange,
}: ExportMenuProps) {
  const allowedTransitionStyles: TransitionConfig["style"][] = [
    "auto",
    "crossfade",
    "multiband",
    "superpose",
    "fade",
    "cut",
    "echo",
    "beatmatch",
  ];

  const toTransitionStyle = (style?: string): TransitionConfig["style"] => {
    if (!style) return "multiband";
    return allowedTransitionStyles.includes(style as TransitionConfig["style"])
      ? (style as TransitionConfig["style"])
      : "multiband";
  };

  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [mixProgress, setMixProgress] = useState<MixProgress | null>(null);
  const [mixId, setMixId] = useState<string | null>(null);
  const [mixStartTime, setMixStartTime] = useState<number>(0);
  const [mixPhase, setMixPhase] = useState<string>("");
  const [mixLog, setMixLog] = useState<Array<{ status: string; detail: string; time: number }>>([]);
  const [elapsed, setElapsed] = useState<string>("0:00");
  const [showMixSettings, setShowMixSettings] = useState(false);
  // Use external state if provided, fallback to internal
  const [internalCrossfade, setInternalCrossfade] = useState(8);
  const [internalTargetDuration, setInternalTargetDuration] = useState(0);
  const [internalTransitionStyle, setInternalTransitionStyle] = useState<string>("multiband");
  const crossfade = externalCrossfade ?? internalCrossfade;
  const targetDuration = externalTargetDuration ?? internalTargetDuration;
  const transitionStyle = externalStyle ?? internalTransitionStyle;
  const setCrossfade = (v: number) => { setInternalCrossfade(v); onTransitionSettingsChange?.(transitionStyle, v, targetDuration); };
  const setTargetDuration = (v: number) => { setInternalTargetDuration(v); onTransitionSettingsChange?.(transitionStyle, crossfade, v); };
  const setTransitionStyle = (v: string) => { setInternalTransitionStyle(v); onTransitionSettingsChange?.(v, crossfade, targetDuration); };
  const cancelMix = useRef<(() => void) | null>(null);

  // Elapsed time ticker
  useEffect(() => {
    if (loading !== "mix" || !mixStartTime) return;
    const iv = setInterval(() => {
      const s = Math.floor((Date.now() - mixStartTime) / 1000);
      setElapsed(`${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`);
    }, 1000);
    return () => clearInterval(iv);
  }, [loading, mixStartTime]);

  const trackUris = tracks.map((t) => t.uri);

  const handleNewPlaylist = async () => {
    setLoading("new");
    try {
      await exportNewPlaylist(`${playlistName} — DJ Mix`, trackUris);
      setSuccess("new");
      setTimeout(() => setSuccess(null), 3000);
    } catch (e) {
      alert(`Erreur: ${(e as Error).message}`);
    }
    setLoading(null);
  };

  const handleReorder = async () => {
    if (!confirm("Cela va réorganiser votre playlist existante. Continuer ?")) return;
    setLoading("reorder");
    try {
      await exportReorder(playlistId, trackUris);
      setSuccess("reorder");
      setTimeout(() => setSuccess(null), 3000);
    } catch (e) {
      alert(`Erreur: ${(e as Error).message}`);
    }
    setLoading(null);
  };

  const handleExportFile = async (format: "csv" | "json") => {
    setLoading(format);
    try {
      const blob = await exportFile(tracks, transitions, format);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `dj-set.${format}`;
      a.click();
      URL.revokeObjectURL(url);
      setSuccess(format);
      setTimeout(() => setSuccess(null), 3000);
    } catch (e) {
      alert(`Erreur: ${(e as Error).message}`);
    }
    setLoading(null);
  };

  const handleMix = () => {
    setLoading("mix");
    setMixProgress(null);
    setMixId(null);
    setIsOpen(false);
    setShowMixSettings(false);
    setMixStartTime(Date.now());
    setMixPhase("downloading");
    setMixLog([]);

    const mixTracks = tracks.map((t) => ({
      id: t.id,
      name: t.name,
      artist: t.artists.join(", "),
      duration_ms: t.duration_ms,
    }));
    const mixTransitions: TransitionConfig[] = transitions.map((transition) => ({
      style: toTransitionStyle(transition.style || transitionStyle),
      duration: transition.duration || crossfade,
    }));

    cancelMix.current = generateMix(mixTracks, crossfade, {
      onStart: () => {},
      onProgress: (data) => {
        setMixProgress(data);
        // Track phase changes
        if (["downloading", "cached", "downloaded", "skipped", "trimming", "analyzing", "mixing"].includes(data.status)) {
          setMixPhase(data.status);
        }
        // Log notable events
        if (["cached", "downloading", "skipped", "downloaded", "trimming", "analyzing", "mixing"].includes(data.status)) {
          setMixLog((prev) => [...prev.slice(-30), { status: data.status, detail: data.detail, time: Date.now() }]);
        }
      },
      onComplete: (id) => {
        setMixId(id);
        setLoading(null);
        setSuccess("mix");
        setMixPhase("done");
        setTimeout(() => setSuccess(null), 5000);
        // Auto-download
        downloadMix(id).catch((e) => console.error("Download failed:", e));
        // Reload history
        if (typeof (window as any).__reloadMixHistory === "function") (window as any).__reloadMixHistory();
      },
      onError: (msg) => {
        alert(`Erreur mix: ${msg}`);
        setLoading(null);
        setMixProgress(null);
        setMixPhase("");
      },
    }, targetDuration, transitionStyle, mixTransitions, playlistId);
  };

  const handleDownloadMix = () => {
    if (!mixId) return;
    downloadMix(mixId).catch((e) => alert(`Erreur téléchargement: ${(e as Error).message}`));
  };

  const ButtonIcon = ({ id, icon: Icon }: { id: string; icon: typeof Download }) => {
    if (loading === id) return <Loader2 className="h-4 w-4 animate-spin" />;
    if (success === id) return <Check className="h-4 w-4 text-green-400" />;
    return <Icon className="h-4 w-4" />;
  };

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 rounded-lg border border-deck-border px-4 py-2 text-sm transition-colors hover:border-amber hover:text-amber"
      >
        <Download className="h-4 w-4" />
        Exporter
      </button>

      {isOpen && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setIsOpen(false)} />
          <div className="absolute right-0 top-full z-20 mt-2 w-64 rounded-xl border border-deck-border bg-deck-card p-2 shadow-xl">
            <button
              onClick={handleNewPlaylist}
              disabled={loading !== null}
              className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm hover:bg-deck-surface disabled:opacity-50"
            >
              <ButtonIcon id="new" icon={ListPlus} />
              <div>
                <div className="font-medium text-sand-50">Nouvelle playlist</div>
                <div className="text-xs text-sand-400">Créer &quot;{playlistName} — DJ Mix&quot;</div>
              </div>
            </button>

            <button
              onClick={handleReorder}
              disabled={loading !== null}
              className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm hover:bg-deck-surface disabled:opacity-50"
            >
              <ButtonIcon id="reorder" icon={ArrowUpDown} />
              <div>
                <div className="font-medium text-sand-50">Réorganiser l&apos;existante</div>
                <div className="text-xs text-sand-400">Modifier l&apos;ordre actuel</div>
              </div>
            </button>

            <div className="my-1 border-t border-deck-border" />

            <button
              onClick={() => handleExportFile("csv")}
              disabled={loading !== null}
              className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm hover:bg-deck-surface disabled:opacity-50"
            >
              <ButtonIcon id="csv" icon={FileDown} />
              <div>
                <div className="font-medium text-sand-50">Exporter CSV</div>
                <div className="text-xs text-sand-400">Tableur compatible</div>
              </div>
            </button>

            <button
              onClick={() => handleExportFile("json")}
              disabled={loading !== null}
              className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm hover:bg-deck-surface disabled:opacity-50"
            >
              <ButtonIcon id="json" icon={FileDown} />
              <div>
                <div className="font-medium text-sand-50">Exporter JSON</div>
                <div className="text-xs text-sand-400">Format développeur</div>
              </div>
            </button>

            <div className="my-1 border-t border-deck-border" />

            <button
              onClick={() => { setIsOpen(false); setShowMixSettings(true); }}
              disabled={loading !== null}
              className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm hover:bg-deck-surface disabled:opacity-50"
            >
              <ButtonIcon id="mix" icon={Music} />
              <div>
                <div className="font-medium text-sand-50">Générer Mix MP3</div>
                <div className="text-xs text-sand-400">Télécharge &amp; concatène avec crossfade</div>
              </div>
            </button>
          </div>
        </>
      )}

      {/* Mix settings panel */}
      {showMixSettings && !loading && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setShowMixSettings(false)} />
          <div className="absolute right-0 top-full z-20 mt-2 w-80 rounded-xl border border-deck-border bg-deck-card p-4 shadow-xl">
            <div className="mb-4 text-sm font-display font-medium text-sand-50">Paramètres du mix</div>

            <div className="mb-4">
              <label className="mb-1 flex items-center justify-between text-xs text-sand-300">
                <span>Crossfade</span>
                <span className="font-mono text-amber">{crossfade}s</span>
              </label>
              <input
                type="range"
                min={0}
                max={15}
                value={crossfade}
                onChange={(e) => setCrossfade(Number(e.target.value))}
                className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-deck-surface"
              />
              <div className="flex justify-between text-[10px] text-sand-500">
                <span>0s</span>
                <span>15s</span>
              </div>
            </div>

            <div className="mb-4">
              <label className="mb-1 flex items-center justify-between text-xs text-sand-300">
                <span>Durée par piste</span>
                <span className="font-mono text-amber">
                  {targetDuration === 0 ? "Complète" : `~${Math.floor(targetDuration / 60)}:${String(targetDuration % 60).padStart(2, "0")}`}
                </span>
              </label>
              <input
                type="range"
                min={0}
                max={300}
                step={15}
                value={targetDuration}
                onChange={(e) => setTargetDuration(Number(e.target.value))}
                className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-deck-surface"
              />
              <div className="flex justify-between text-[10px] text-sand-500">
                <span>Complète</span>
                <span>5:00</span>
              </div>
              {targetDuration > 0 && (
                <p className="mt-1 text-[10px] text-sand-400">
                  Les pistes trop longues seront coupées sur le meilleur passage
                </p>
              )}
            </div>

            <div className="mb-4">
              <label className="mb-2 block text-xs text-sand-300">Style de transition</label>
              <div className="grid grid-cols-3 gap-1.5">
                {([
                  { value: "crossfade", label: "Crossfade", desc: "Fondu croisé linéaire" },
                  { value: "multiband", label: "3 bandes", desc: "Transition DJ type EQ (bass/mid/high)" },
                  { value: "superpose", label: "Superpose", desc: "Superposition franche des deux pistes" },
                  { value: "fade", label: "Fade", desc: "Fondu sortie/entrée progressif" },
                  { value: "cut", label: "Cut", desc: "Enchaînement direct" },
                  { value: "echo", label: "Echo", desc: "Queue réverbérée" },
                  { value: "beatmatch", label: "Beatmatch", desc: "Fondu lissé (equal power)" },
                  { value: "auto", label: "Auto", desc: "Analyse et adapte chaque transition" },
                ] as const).map((t) => (
                  <button
                    key={t.value}
                    onClick={() => setTransitionStyle(t.value)}
                    className={`rounded-lg border px-2 py-1.5 text-center text-[11px] transition-colors ${
                      transitionStyle === t.value
                        ? "border-amber/40 bg-amber/10 text-amber"
                        : "border-deck-border text-sand-300 hover:border-deck-muted"
                    }`}
                    title={t.desc}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
              <p className="mt-1.5 text-[10px] text-sand-400">
                {transitionStyle === "auto"
                  ? "Analyse le BPM et l'énergie pour choisir le meilleur style"
                  : transitionStyle === "crossfade"
                  ? "Fondu croisé classique entre les pistes"
                  : transitionStyle === "multiband"
                  ? "Mix DJ sur 3 bandes: bass, medium, high"
                  : transitionStyle === "superpose"
                  ? "Superpose les deux pistes sans atténuation"
                  : transitionStyle === "fade"
                  ? "La piste s'efface puis la suivante monte"
                  : transitionStyle === "cut"
                  ? "Passage direct sans fondu"
                  : transitionStyle === "echo"
                  ? "Effet de réverbération en sortie"
                  : "Crossfade lissé, idéal quand les BPM sont proches"}
              </p>
            </div>

            {(() => {
              const durPerTrack = (t: Track) =>
                targetDuration > 0 ? targetDuration : t.duration_ms / 1000;
              const totalDurS = Math.max(
                0,
                tracks.reduce((s, t) => s + durPerTrack(t), 0) -
                  (tracks.length - 1) * crossfade,
              );
              const cachedTracks = tracks.filter((t) => t.audio_cached);
              const uncachedTracks = tracks.filter((t) => !t.audio_cached);
              const cachedDurS = cachedTracks.reduce(
                (s, t) => s + durPerTrack(t),
                0,
              );
              const uncachedDurS = uncachedTracks.reduce(
                (s, t) => s + durPerTrack(t),
                0,
              );
              const fmtMin = (s: number) =>
                s >= 60
                  ? `${Math.floor(s / 60)}m${String(Math.round(s % 60)).padStart(2, "0")}s`
                  : `${Math.round(s)}s`;
              return (
                <div className="mb-3 space-y-1 rounded-lg bg-deck-surface px-3 py-2 text-[11px]">
                  <div className="flex items-center justify-between text-sand-300">
                    <span>Durée estimée du mix</span>
                    <span className="font-mono text-amber">
                      ~{fmtMin(totalDurS)}
                    </span>
                  </div>
                  {cachedTracks.length > 0 && (
                    <div className="flex items-center justify-between text-emerald-400">
                      <span>
                        ✓ Déjà en cache ({cachedTracks.length} piste
                        {cachedTracks.length > 1 ? "s" : ""})
                      </span>
                      <span className="font-mono">~{fmtMin(cachedDurS)}</span>
                    </div>
                  )}
                  {uncachedTracks.length > 0 && (
                    <div className="flex items-center justify-between text-yellow-400">
                      <span>
                        ⬇ À télécharger ({uncachedTracks.length} piste
                        {uncachedTracks.length > 1 ? "s" : ""})
                      </span>
                      <span className="font-mono">~{fmtMin(uncachedDurS)}</span>
                    </div>
                  )}
                </div>
              );
            })()}

            <button
              onClick={handleMix}
              className="flex w-full items-center justify-center gap-2 rounded-full bg-amber px-4 py-2.5 font-display text-sm font-semibold text-deck-bg transition-all hover:bg-amber-light hover:shadow-lg hover:shadow-amber/20"
            >
              <Music className="h-4 w-4" />
              Lancer la génération
            </button>
          </div>
        </>
      )}

      {/* Mix progress overlay */}
      {loading === "mix" && mixProgress && (
        <div className="fixed bottom-24 right-4 z-50 w-96 rounded-xl border border-deck-border bg-deck-card p-4 shadow-2xl">
          {/* Header with elapsed time */}
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm font-medium text-sand-50">
              <Loader2 className="h-4 w-4 animate-spin text-amber" />
              Génération du mix
            </div>
            <span className="font-mono text-xs text-sand-400">{elapsed}</span>
          </div>

          {/* Step indicators */}
          <div className="mb-3 flex items-center gap-1">
            {[
              { key: "downloading", label: "Téléchargement", icon: "⬇" },
              ...(targetDuration > 0 ? [{ key: "trimming", label: "Découpe", icon: "✂" }] : []),
              ...(transitionStyle === "auto" ? [{ key: "analyzing", label: "Analyse", icon: "🔍" }] : []),
              { key: "mixing", label: "Mixage", icon: "🎛" },
            ].map((step, idx, arr) => {
              const phases = ["downloading", "cached", "downloaded", "trimming", "analyzing", "mixing", "done"];
              const currentIdx = phases.indexOf(mixPhase);
              const stepIdx = phases.indexOf(step.key);
              const isDone = currentIdx > stepIdx || (step.key === "downloading" && ["downloaded", "trimming", "analyzing", "mixing", "done"].includes(mixPhase));
              const isActive = step.key === "downloading"
                ? ["downloading", "cached"].includes(mixPhase)
                : mixPhase === step.key;
              return (
                <div key={step.key} className="flex flex-1 items-center gap-1">
                  <div className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] transition-all ${
                    isDone ? "bg-amber text-deck-bg" : isActive ? "bg-amber/20 text-amber ring-1 ring-amber" : "bg-deck-surface text-sand-500"
                  }`}>
                    {isDone ? "✓" : step.icon}
                  </div>
                  {idx < arr.length - 1 && (
                    <div className={`h-0.5 flex-1 rounded-full transition-all ${isDone ? "bg-amber" : "bg-deck-surface"}`} />
                  )}
                </div>
              );
            })}
          </div>

          {/* Current action detail */}
          <div className="mb-2 text-xs text-sand-300 truncate">
            {mixProgress.detail}
          </div>

          {/* Progress bar — shown when we have current/total */}
          {mixProgress.total > 0 && (
            <div className="mb-2">
              <div className="h-2 w-full overflow-hidden rounded-full bg-deck-surface">
                <div
                  className="h-full rounded-full bg-amber transition-all duration-300"
                  style={{ width: `${Math.round((mixProgress.current / mixProgress.total) * 100)}%` }}
                />
              </div>
              <div className="mt-1 flex items-center justify-between text-[11px] text-sand-400">
                <span>
                  {mixPhase === "downloading" || mixPhase === "cached"
                    ? `Piste ${mixProgress.current}/${mixProgress.total}`
                    : mixPhase === "trimming"
                    ? `Découpe ${mixProgress.current}/${mixProgress.total}`
                    : mixPhase === "analyzing"
                    ? `Transition ${mixProgress.current}/${mixProgress.total}`
                    : mixPhase === "mixing"
                    ? `${Math.floor(mixProgress.current / 60)}:${String(Math.floor(mixProgress.current % 60)).padStart(2, "0")} / ${Math.floor(mixProgress.total / 60)}:${String(Math.floor(mixProgress.total % 60)).padStart(2, "0")}`
                    : `${mixProgress.current}/${mixProgress.total}`}
                </span>
                <span className="font-mono">{Math.round((mixProgress.current / mixProgress.total) * 100)}%</span>
              </div>
            </div>
          )}

          {/* Activity log — last 4 events */}
          {mixLog.length > 0 && (
            <div className="mt-2 max-h-24 space-y-0.5 overflow-hidden border-t border-deck-border/50 pt-2">
              {mixLog.slice(-4).map((log, i) => (
                <div key={i} className="flex items-center gap-1.5 text-[10px]">
                  <span className={
                    log.status === "cached" ? "text-blue-400" :
                    log.status === "downloading" ? "text-yellow-400" :
                    log.status === "skipped" ? "text-red-400" :
                    log.status === "downloaded" ? "text-green-400" :
                    "text-sand-500"
                  }>
                    {log.status === "cached" ? "● cache" :
                     log.status === "downloading" ? "● téléch." :
                     log.status === "skipped" ? "● échec" :
                     log.status === "downloaded" ? "● résumé" :
                     log.status === "trimming" ? "✂ découpe" :
                     log.status === "analyzing" ? "🔍 analyse" :
                     log.status === "mixing" ? "🎛 mixage" :
                     "●"}
                  </span>
                  <span className="truncate text-sand-400">{log.detail}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Mix ready - download button */}
      {mixId && success === "mix" && (
        <div className="fixed bottom-24 right-4 z-50 w-96 rounded-xl border border-amber/30 bg-deck-card p-4 shadow-2xl">
          <div className="mb-2 flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm font-medium text-amber">
              <Check className="h-4 w-4" />
              Mix prêt !
            </div>
            <span className="font-mono text-xs text-sand-400">{elapsed}</span>
          </div>
          <p className="mb-3 text-xs text-sand-300">
            {tracks.length} pistes · Téléchargement automatique lancé
          </p>
          <button
            onClick={handleDownloadMix}
            className="flex w-full items-center justify-center gap-2 rounded-full bg-amber px-4 py-2.5 font-display text-sm font-semibold text-deck-bg transition-all hover:bg-amber-light hover:shadow-lg hover:shadow-amber/20"
          >
            <Download className="h-4 w-4" />
            Re-télécharger le mix MP3
          </button>
        </div>
      )}
    </div>
  );
}
