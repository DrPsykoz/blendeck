"use client";

import { TransitionScore } from "@/lib/api";

interface TransitionBadgeProps {
  transition: TransitionScore | undefined;
  compact?: boolean;
}

function getColor(score: number): string {
  if (score >= 0.8) return "bg-emerald-500/10 text-emerald-400 border-emerald-500/20";
  if (score >= 0.6) return "bg-amber/10 text-amber-light border-amber/20";
  return "bg-red-500/10 text-red-400 border-red-500/20";
}

function getLabel(score: number): string {
  if (score >= 0.8) return "Smooth";
  if (score >= 0.6) return "OK";
  return "Rough";
}

export default function TransitionBadge({ transition, compact }: TransitionBadgeProps) {
  if (!transition) return null;

  const score = transition.total_score;
  const color = getColor(score);

  if (compact) {
    return (
      <span className={`inline-flex items-center rounded-md px-1.5 py-0.5 font-mono text-[11px] font-medium border ${color}`}>
        {(score * 100).toFixed(0)}%
      </span>
    );
  }

  return (
    <div className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs ${color}`}>
      <span className="font-semibold">{getLabel(score)}</span>
      <span className="font-mono opacity-70">{(score * 100).toFixed(0)}%</span>
      <div className="flex gap-1.5 font-mono text-[10px] opacity-50">
        <span>BPM:{(transition.bpm_score * 100).toFixed(0)}</span>
        <span>Key:{(transition.key_score * 100).toFixed(0)}</span>
        <span>NRG:{(transition.energy_score * 100).toFixed(0)}</span>
      </div>
    </div>
  );
}
