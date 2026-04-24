"use client";

import { TransitionScore, Track } from "@/lib/api";
import { Play, Pause, Loader2, ChevronDown } from "lucide-react";

interface TransitionBadgeProps {
  transition: TransitionScore | undefined;
  compact?: boolean;
  onStyleChange?: (style: string) => void;
  onPlay?: () => void;
  isPlaying?: boolean;
  isLoading?: boolean;
  fromTrack?: Track;
  toTrack?: Track;
}

const STYLE_OPTIONS = [
  { value: "auto", label: "Auto" },
  { value: "crossfade", label: "Crossfade" },
  { value: "multiband", label: "3 bandes" },
  { value: "superpose", label: "Superpose" },
  { value: "fade", label: "Fade" },
  { value: "cut", label: "Cut" },
  { value: "echo", label: "Echo" },
  { value: "beatmatch", label: "Beatmatch" },
] as const;

function getScoreColor(score: number) {
  if (score >= 0.8) return { text: "text-emerald-400", bg: "bg-emerald-400", border: "border-emerald-500/30", line: "via-emerald-500/30" };
  if (score >= 0.6) return { text: "text-amber-light", bg: "bg-amber-light", border: "border-amber/30", line: "via-amber/30" };
  return { text: "text-red-400", bg: "bg-red-400", border: "border-red-500/30", line: "via-red-500/30" };
}

function getBpmDelta(from?: Track, to?: Track): string | null {
  const a = from?.audio_features?.tempo;
  const b = to?.audio_features?.tempo;
  if (!a || !b) return null;
  const delta = Math.round(b - a);
  if (delta === 0) return "=";
  return delta > 0 ? `+${delta}` : `${delta}`;
}

function getKeyInfo(from?: Track, to?: Track): string | null {
  if (!from?.camelot || !to?.camelot) return null;
  const fk = `${from.camelot.number}${from.camelot.letter}`;
  const tk = `${to.camelot.number}${to.camelot.letter}`;
  if (fk === tk) return "=";
  return `${fk}→${tk}`;
}

export default function TransitionBadge({ transition, compact, onStyleChange, onPlay, isPlaying, isLoading, fromTrack, toTrack }: TransitionBadgeProps) {
  if (!transition) return null;

  const score = transition.total_score;
  const colors = getScoreColor(score);
  const bpmDelta = getBpmDelta(fromTrack, toTrack);
  const keyInfo = getKeyInfo(fromTrack, toTrack);
  const selectedStyle = transition.style || "multiband";

  const stylePicker = (
    <label className="relative block">
      <select
        value={selectedStyle}
        onChange={(e) => onStyleChange?.(e.target.value)}
        className="appearance-none rounded-md border border-deck-border/70 bg-deck-bg/90 px-8 py-1 text-xs font-medium text-sand-100 outline-none focus:outline-none focus:ring-0 transition-colors hover:border-deck-muted"
      >
        {STYLE_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3 w-3 -translate-y-1/2 text-sand-400" />
    </label>
  );

  if (compact) {
    return (
      <div className="group/badge relative flex w-full items-center justify-center px-4 py-1 select-none">
        {/* Horizontal connector line behind the badge */}
        <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-deck-border/40" />

        {/* Badge content - opaque bg to mask the line */}
        <div className={`relative z-10 flex items-center gap-3 rounded-lg border ${colors.border} bg-deck-surface px-3 py-1`}>
          {onPlay && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onPlay();
              }}
              disabled={isLoading}
              className={`flex h-5 w-5 items-center justify-center rounded-full transition-all ${
                isPlaying || isLoading ? colors.text : "text-sand-500"
              }`}
              title={isLoading ? "Chargement..." : isPlaying ? "Pause" : "Écouter la transition"}
            >
              {isLoading ? (
                <Loader2 className="h-2.5 w-2.5 animate-spin" />
              ) : isPlaying ? (
                <Pause className="h-2.5 w-2.5" fill="currentColor" />
              ) : (
                <Play className="h-2.5 w-2.5" fill="currentColor" />
              )}
            </button>
          )}

          <span className={`font-mono text-xs font-semibold tabular-nums ${colors.text}`}>
            {(score * 100).toFixed(0)}%
          </span>

          {stylePicker}

          {bpmDelta && (
            <span className="font-mono text-xs text-sand-400">
              {bpmDelta === "=" ? "BPM=" : `BPM${bpmDelta}`}
            </span>
          )}

          {keyInfo && (
            <span className="font-mono text-xs text-sand-400">
              {keyInfo === "=" ? "Key=" : keyInfo}
            </span>
          )}
        </div>
      </div>
    );
  }

  // Full inline transition connector
  return (
    <div className="group/badge flex w-full items-center gap-0 px-2 select-none">
      {/* Left line */}
      <div className={`h-px flex-1 bg-gradient-to-r from-transparent ${colors.line} to-transparent opacity-40`} />

      {/* Center content */}
      <div className={`flex items-center gap-2 rounded-lg border ${colors.border} bg-deck-surface/60 backdrop-blur-sm px-2 py-1`}>
        {/* Play button */}
        {onPlay && (
          <button
            onClick={(e) => { e.stopPropagation(); onPlay(); }}
            disabled={isLoading}
            className={`flex h-4 w-4 items-center justify-center rounded-full transition-all ${
              isPlaying || isLoading
                ? `${colors.text}`
                : `text-sand-500 opacity-0 group-hover/badge:opacity-100 hover:${colors.text}`
            }`}
            title={isLoading ? "Chargement..." : isPlaying ? "Pause" : "Écouter la transition"}
          >
            {isLoading ? (
              <Loader2 className="h-2.5 w-2.5 animate-spin" />
            ) : isPlaying ? (
              <Pause className="h-2.5 w-2.5" fill="currentColor" />
            ) : (
              <Play className="h-2.5 w-2.5" fill="currentColor" />
            )}
          </button>
        )}

        {/* Score */}
        <span className={`font-mono text-[11px] font-semibold tabular-nums ${colors.text}`}>
          {(score * 100).toFixed(0)}%
        </span>

        {stylePicker}

        {/* Separator + details */}
        {(bpmDelta || keyInfo) && (
          <>
            <ChevronDown className={`h-2.5 w-2.5 ${colors.text} opacity-40`} />
            <div className="flex items-center gap-1.5 font-mono text-[10px] text-sand-400">
              {bpmDelta && (
                <span className="tabular-nums" title="Δ BPM">
                  {bpmDelta === "=" ? "BPM=" : `BPM${bpmDelta}`}
                </span>
              )}
              {keyInfo && (
                <span className="tabular-nums" title="Tonalité">
                  {keyInfo === "=" ? "Key=" : keyInfo}
                </span>
              )}
            </div>
          </>
        )}
      </div>

      {/* Right line */}
      <div className={`h-px flex-1 bg-gradient-to-r from-transparent ${colors.line} to-transparent opacity-40`} />
    </div>
  );
}
