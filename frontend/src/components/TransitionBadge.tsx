"use client";

import { TransitionScore, Track } from "@/lib/api";
import { Play, Pause, Loader2, ArrowDown, ChevronDown } from "lucide-react";

interface TransitionBadgeProps {
  transition: TransitionScore | undefined;
  compact?: boolean;
  onPlay?: () => void;
  isPlaying?: boolean;
  isLoading?: boolean;
  fromTrack?: Track;
  toTrack?: Track;
}

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

export default function TransitionBadge({ transition, compact, onPlay, isPlaying, isLoading, fromTrack, toTrack }: TransitionBadgeProps) {
  if (!transition) return null;

  const score = transition.total_score;
  const colors = getScoreColor(score);
  const bpmDelta = getBpmDelta(fromTrack, toTrack);
  const keyInfo = getKeyInfo(fromTrack, toTrack);

  if (compact) {
    return (
      <span className={`group/badge inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 font-mono text-[11px] font-medium border border-deck-border/50 ${colors.text} ${isPlaying ? "animate-pulse" : ""}`}>
        {(score * 100).toFixed(0)}%
      </span>
    );
  }

  // Full inline transition connector
  return (
    <div className="group/badge flex w-full items-center gap-0 px-2 select-none">
      {/* Left line */}
      <div className={`h-px flex-1 bg-gradient-to-r from-transparent ${colors.line} to-transparent opacity-40`} />

      {/* Center content */}
      <div className={`flex items-center gap-1.5 rounded-full border ${colors.border} bg-deck-surface/60 backdrop-blur-sm px-2.5 py-0.5`}>
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
