"use client";

import { useState, useRef, useEffect } from "react";
import { Track, TransitionScore, exportNewPlaylist, exportReorder, exportFile, generateMix, mixDownloadUrl, MixProgress, TransitionConfig } from "@/lib/api";
import { Download, ListPlus, ArrowUpDown, FileDown, Loader2, Check, Music } from "lucide-react";

interface ExportMenuProps {
  tracks: Track[];
  transitions: TransitionScore[];
  playlistId: string;
  playlistName: string;
}

export default function ExportMenu({
  tracks,
  transitions,
  playlistId,
  playlistName,
}: ExportMenuProps) {
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
  const [crossfade, setCrossfade] = useState(8);
  const [targetDuration, setTargetDuration] = useState(0); // 0 = no trim
  const [transitionStyle, setTransitionStyle] = useState<string>("crossfade");
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
        const a = document.createElement("a");
        a.href = mixDownloadUrl(id);
        a.download = `dj-mix.mp3`;
        a.click();
        // Reload history
        if (typeof (window as any).__reloadMixHistory === "function") (window as any).__reloadMixHistory();
      },
      onError: (msg) => {
        alert(`Erreur mix: ${msg}`);
        setLoading(null);
        setMixProgress(null);
        setMixPhase("");
      },
    }, targetDuration, transitionStyle, undefined, playlistId);
  };

  const handleDownloadMix = () => {
    if (!mixId) return;
    const a = document.createElement("a");
    a.href = mixDownloadUrl(mixId);
    a.download = `dj-mix.mp3`;
    a.click();
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
        className="flex items-center gap-2 rounded-lg border border-spotify-gray px-4 py-2 text-sm transition-colors hover:border-spotify-green hover:text-spotify-green"
      >
        <Download className="h-4 w-4" />
        Exporter
      </button>

      {isOpen && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setIsOpen(false)} />
          <div className="absolute right-0 top-full z-20 mt-2 w-64 rounded-xl border border-spotify-gray bg-spotify-black p-2 shadow-xl">
            <button
              onClick={handleNewPlaylist}
              disabled={loading !== null}
              className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm hover:bg-spotify-gray/50 disabled:opacity-50"
            >
              <ButtonIcon id="new" icon={ListPlus} />
              <div>
                <div className="font-medium">Nouvelle playlist</div>
                <div className="text-xs text-spotify-light">Créer &quot;{playlistName} — DJ Mix&quot;</div>
              </div>
            </button>

            <button
              onClick={handleReorder}
              disabled={loading !== null}
              className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm hover:bg-spotify-gray/50 disabled:opacity-50"
            >
              <ButtonIcon id="reorder" icon={ArrowUpDown} />
              <div>
                <div className="font-medium">Réorganiser l&apos;existante</div>
                <div className="text-xs text-spotify-light">Modifier l&apos;ordre actuel</div>
              </div>
            </button>

            <div className="my-1 border-t border-spotify-gray" />

            <button
              onClick={() => handleExportFile("csv")}
              disabled={loading !== null}
              className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm hover:bg-spotify-gray/50 disabled:opacity-50"
            >
              <ButtonIcon id="csv" icon={FileDown} />
              <div>
                <div className="font-medium">Exporter CSV</div>
                <div className="text-xs text-spotify-light">Tableur compatible</div>
              </div>
            </button>

            <button
              onClick={() => handleExportFile("json")}
              disabled={loading !== null}
              className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm hover:bg-spotify-gray/50 disabled:opacity-50"
            >
              <ButtonIcon id="json" icon={FileDown} />
              <div>
                <div className="font-medium">Exporter JSON</div>
                <div className="text-xs text-spotify-light">Format développeur</div>
              </div>
            </button>

            <div className="my-1 border-t border-spotify-gray" />

            <button
              onClick={() => { setIsOpen(false); setShowMixSettings(true); }}
              disabled={loading !== null}
              className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm hover:bg-spotify-gray/50 disabled:opacity-50"
            >
              <ButtonIcon id="mix" icon={Music} />
              <div>
                <div className="font-medium">Générer Mix MP3</div>
                <div className="text-xs text-spotify-light">Télécharge &amp; concatène avec crossfade</div>
              </div>
            </button>
          </div>
        </>
      )}

      {/* Mix settings panel */}
      {showMixSettings && !loading && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setShowMixSettings(false)} />
          <div className="absolute right-0 top-full z-20 mt-2 w-80 rounded-xl border border-spotify-gray bg-spotify-black p-4 shadow-xl">
            <div className="mb-4 text-sm font-medium">Paramètres du mix</div>

            <div className="mb-4">
              <label className="mb-1 flex items-center justify-between text-xs text-spotify-light">
                <span>Crossfade</span>
                <span className="font-mono text-spotify-green">{crossfade}s</span>
              </label>
              <input
                type="range"
                min={0}
                max={15}
                value={crossfade}
                onChange={(e) => setCrossfade(Number(e.target.value))}
                className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-spotify-gray accent-spotify-green"
              />
              <div className="flex justify-between text-[10px] text-spotify-light/50">
                <span>0s</span>
                <span>15s</span>
              </div>
            </div>

            <div className="mb-4">
              <label className="mb-1 flex items-center justify-between text-xs text-spotify-light">
                <span>Durée par piste</span>
                <span className="font-mono text-spotify-green">
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
                className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-spotify-gray accent-spotify-green"
              />
              <div className="flex justify-between text-[10px] text-spotify-light/50">
                <span>Complète</span>
                <span>5:00</span>
              </div>
              {targetDuration > 0 && (
                <p className="mt-1 text-[10px] text-spotify-light/70">
                  Les pistes trop longues seront coupées sur le meilleur passage
                </p>
              )}
            </div>

            <div className="mb-4">
              <label className="mb-2 block text-xs text-spotify-light">Style de transition</label>
              <div className="grid grid-cols-3 gap-1.5">
                {([
                  { value: "crossfade", label: "Crossfade", desc: "Fondu croisé linéaire" },
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
                        ? "border-spotify-green bg-spotify-green/10 text-spotify-green"
                        : "border-spotify-gray text-spotify-light hover:border-spotify-light"
                    }`}
                    title={t.desc}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
              <p className="mt-1.5 text-[10px] text-spotify-light/70">
                {transitionStyle === "auto"
                  ? "Analyse le BPM et l'énergie pour choisir le meilleur style"
                  : transitionStyle === "crossfade"
                  ? "Fondu croisé classique entre les pistes"
                  : transitionStyle === "fade"
                  ? "La piste s'efface puis la suivante monte"
                  : transitionStyle === "cut"
                  ? "Passage direct sans fondu"
                  : transitionStyle === "echo"
                  ? "Effet de réverbération en sortie"
                  : "Crossfade lissé, idéal quand les BPM sont proches"}
              </p>
            </div>

            {targetDuration > 0 && (
              <div className="mb-3 rounded-lg bg-spotify-gray/30 px-3 py-2 text-xs text-spotify-light">
                Durée estimée : ~{Math.round((tracks.length * targetDuration - (tracks.length - 1) * crossfade) / 60)} min
              </div>
            )}

            <button
              onClick={handleMix}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-spotify-green px-4 py-2 text-sm font-medium text-black transition-colors hover:bg-green-400"
            >
              <Music className="h-4 w-4" />
              Lancer la génération
            </button>
          </div>
        </>
      )}

      {/* Mix progress overlay */}
      {loading === "mix" && mixProgress && (
        <div className="fixed bottom-24 right-4 z-50 w-96 rounded-xl border border-spotify-gray bg-spotify-black p-4 shadow-2xl">
          {/* Header with elapsed time */}
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Loader2 className="h-4 w-4 animate-spin text-spotify-green" />
              Génération du mix
            </div>
            <span className="font-mono text-xs text-spotify-light">{elapsed}</span>
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
                    isDone ? "bg-spotify-green text-black" : isActive ? "bg-spotify-green/20 text-spotify-green ring-1 ring-spotify-green" : "bg-spotify-gray/50 text-spotify-light/50"
                  }`}>
                    {isDone ? "✓" : step.icon}
                  </div>
                  {idx < arr.length - 1 && (
                    <div className={`h-0.5 flex-1 rounded-full transition-all ${isDone ? "bg-spotify-green" : "bg-spotify-gray/50"}`} />
                  )}
                </div>
              );
            })}
          </div>

          {/* Current action detail */}
          <div className="mb-2 text-xs text-spotify-light truncate">
            {mixProgress.detail}
          </div>

          {/* Progress bar — shown when we have current/total */}
          {mixProgress.total > 0 && (
            <div className="mb-2">
              <div className="h-2 w-full overflow-hidden rounded-full bg-spotify-gray">
                <div
                  className="h-full rounded-full bg-spotify-green transition-all duration-300"
                  style={{ width: `${Math.round((mixProgress.current / mixProgress.total) * 100)}%` }}
                />
              </div>
              <div className="mt-1 flex items-center justify-between text-[11px] text-spotify-light">
                <span>
                  {mixPhase === "downloading" || mixPhase === "cached"
                    ? `Piste ${mixProgress.current}/${mixProgress.total}`
                    : mixPhase === "trimming"
                    ? `Découpe ${mixProgress.current}/${mixProgress.total}`
                    : mixPhase === "analyzing"
                    ? `Transition ${mixProgress.current}/${mixProgress.total}`
                    : `${mixProgress.current}/${mixProgress.total}`}
                </span>
                <span className="font-mono">{Math.round((mixProgress.current / mixProgress.total) * 100)}%</span>
              </div>
            </div>
          )}

          {/* Activity log — last 4 events */}
          {mixLog.length > 0 && (
            <div className="mt-2 max-h-24 space-y-0.5 overflow-hidden border-t border-spotify-gray/50 pt-2">
              {mixLog.slice(-4).map((log, i) => (
                <div key={i} className="flex items-center gap-1.5 text-[10px]">
                  <span className={
                    log.status === "cached" ? "text-blue-400" :
                    log.status === "downloading" ? "text-yellow-400" :
                    log.status === "skipped" ? "text-red-400" :
                    log.status === "downloaded" ? "text-green-400" :
                    "text-spotify-light/60"
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
                  <span className="truncate text-spotify-light/70">{log.detail}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Mix ready - download button */}
      {mixId && success === "mix" && (
        <div className="fixed bottom-24 right-4 z-50 w-96 rounded-xl border border-spotify-green bg-spotify-black p-4 shadow-2xl">
          <div className="mb-2 flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm font-medium text-spotify-green">
              <Check className="h-4 w-4" />
              Mix prêt !
            </div>
            <span className="font-mono text-xs text-spotify-light">{elapsed}</span>
          </div>
          <p className="mb-3 text-xs text-spotify-light">
            {tracks.length} pistes · Téléchargement automatique lancé
          </p>
          <button
            onClick={handleDownloadMix}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-spotify-green px-4 py-2 text-sm font-medium text-black transition-colors hover:bg-green-400"
          >
            <Download className="h-4 w-4" />
            Re-télécharger le mix MP3
          </button>
        </div>
      )}
    </div>
  );
}
