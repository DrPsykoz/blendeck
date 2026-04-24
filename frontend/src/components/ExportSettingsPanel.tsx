"use client";

import { Sliders } from "lucide-react";

const TRANSITION_STYLES = [
  { value: "multiband", label: "3 bandes", desc: "Mix DJ EQ (bass/mid/high)" },
  { value: "crossfade", label: "Crossfade", desc: "Fondu croisé linéaire" },
  { value: "superpose", label: "Superpose", desc: "Superposition des deux pistes" },
  { value: "fade", label: "Fade", desc: "Fondu sortie/entrée progressif" },
  { value: "cut", label: "Cut", desc: "Enchaînement direct" },
  { value: "echo", label: "Echo", desc: "Queue réverbérée" },
  { value: "beatmatch", label: "Beatmatch", desc: "Fondu lissé equal power" },
  { value: "auto", label: "Auto", desc: "Analyse et adapte chaque transition" },
] as const;

interface ExportSettingsPanelProps {
  transitionStyle: string;
  crossfade: number;
  targetDuration: number;
  onTransitionStyleChange: (style: string) => void;
  onCrossfadeChange: (value: number) => void;
  onTargetDurationChange: (value: number) => void;
  trackCount?: number;
  totalTracksDurationMs?: number;
}

function fmtDuration(s: number): string {
  if (s >= 3600) {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    return `${h}h${String(m).padStart(2, "0")}m`;
  }
  return `${Math.floor(s / 60)}m${String(Math.round(s % 60)).padStart(2, "0")}s`;
}

export default function ExportSettingsPanel({
  transitionStyle,
  crossfade,
  targetDuration,
  onTransitionStyleChange,
  onCrossfadeChange,
  onTargetDurationChange,
  trackCount = 0,
  totalTracksDurationMs = 0,
}: ExportSettingsPanelProps) {
  const durPerTrack = targetDuration > 0 ? targetDuration : (totalTracksDurationMs / 1000 / Math.max(trackCount, 1));
  const estimatedTotal = Math.max(0, durPerTrack * trackCount - (trackCount - 1) * crossfade);

  return (
    <div className="rounded-xl border border-deck-border bg-deck-card p-4 space-y-5">
      <div className="flex items-center gap-2 text-sm font-display font-medium text-sand-50">
        <Sliders className="h-4 w-4 text-amber" />
        Paramètres d'export
      </div>

      {/* Transition style */}
      <div>
        <label className="mb-2 block text-xs font-medium text-sand-300">Style de transition</label>
        <div className="grid grid-cols-4 gap-1.5">
          {TRANSITION_STYLES.map((t) => (
            <button
              key={t.value}
              onClick={() => onTransitionStyleChange(t.value)}
              title={t.desc}
              className={`rounded-lg border px-1.5 py-1.5 text-center text-[11px] font-medium transition-colors ${
                transitionStyle === t.value
                  ? "border-amber/40 bg-amber/10 text-amber"
                  : "border-deck-border text-sand-400 hover:border-deck-muted hover:text-sand-200"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <p className="mt-1.5 text-[10px] text-sand-500">
          {TRANSITION_STYLES.find((t) => t.value === transitionStyle)?.desc ?? ""}
        </p>
      </div>

      {/* Crossfade duration */}
      <div>
        <label className="mb-1.5 flex items-center justify-between text-xs text-sand-300">
          <span>Durée de transition</span>
          <span className="font-mono text-amber font-medium">{crossfade}s</span>
        </label>
        <input
          type="range"
          min={0}
          max={15}
          value={crossfade}
          onChange={(e) => onCrossfadeChange(Number(e.target.value))}
          className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-deck-surface accent-amber"
        />
        <div className="mt-1 flex justify-between text-[10px] text-sand-500">
          <span>Aucune</span>
          <span>15s</span>
        </div>
      </div>

      {/* Target duration per track */}
      <div>
        <label className="mb-1.5 flex items-center justify-between text-xs text-sand-300">
          <span>Durée par piste</span>
          <span className="font-mono text-amber font-medium">
            {targetDuration === 0
              ? "Complète"
              : `${Math.floor(targetDuration / 60)}:${String(targetDuration % 60).padStart(2, "0")}`}
          </span>
        </label>
        <input
          type="range"
          min={0}
          max={300}
          step={15}
          value={targetDuration}
          onChange={(e) => onTargetDurationChange(Number(e.target.value))}
          className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-deck-surface accent-amber"
        />
        <div className="mt-1 flex justify-between text-[10px] text-sand-500">
          <span>Piste complète</span>
          <span>5:00</span>
        </div>
        {targetDuration > 0 && (
          <p className="mt-1 text-[10px] text-sand-400">
            Les pistes trop longues seront coupées sur le meilleur passage
          </p>
        )}
      </div>

      {/* Estimated mix duration */}
      {trackCount > 0 && (
        <div className="rounded-lg bg-deck-surface px-3 py-2.5 space-y-1">
          <div className="flex items-center justify-between text-[11px]">
            <span className="text-sand-400">Durée estimée du mix</span>
            <span className="font-mono font-semibold text-amber">~{fmtDuration(estimatedTotal)}</span>
          </div>
          <div className="flex items-center justify-between text-[10px] text-sand-500">
            <span>{trackCount} pistes · {crossfade}s crossfade</span>
            <span>
              {targetDuration > 0
                ? `~${Math.floor(targetDuration / 60)}:${String(targetDuration % 60).padStart(2, "0")} / piste`
                : "durée originale"}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
