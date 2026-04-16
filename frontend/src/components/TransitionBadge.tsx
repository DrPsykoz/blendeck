"use client";

import { TransitionScore } from "@/lib/api";

interface TransitionBadgeProps {
  transition: TransitionScore | undefined;
  compact?: boolean;
}

function getColor(score: number): string {
  if (score >= 0.8) return "bg-green-500/20 text-green-400 border-green-500/30";
  if (score >= 0.6) return "bg-yellow-500/20 text-yellow-400 border-yellow-500/30";
  return "bg-red-500/20 text-red-400 border-red-500/30";
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
      <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium border ${color}`}>
        {(score * 100).toFixed(0)}%
      </span>
    );
  }

  return (
    <div className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs ${color}`}>
      <span className="font-semibold">{getLabel(score)}</span>
      <span className="opacity-70">{(score * 100).toFixed(0)}%</span>
      <div className="flex gap-1 text-[10px] opacity-60">
        <span>BPM:{(transition.bpm_score * 100).toFixed(0)}</span>
        <span>Key:{(transition.key_score * 100).toFixed(0)}</span>
        <span>NRG:{(transition.energy_score * 100).toFixed(0)}</span>
      </div>
    </div>
  );
}
