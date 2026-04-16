"use client";

import { AnalysisProgress as ProgressData } from "@/lib/api";
import { Activity, CheckCircle, XCircle, Loader2, Music2 } from "lucide-react";

interface AnalysisProgressProps {
  total: number;
  needAnalysis: number;
  cached: number;
  events: ProgressData[];
  isComplete: boolean;
}

export default function AnalysisProgress({
  total,
  needAnalysis,
  cached,
  events,
  isComplete,
}: AnalysisProgressProps) {
  const doneCount = events.filter((e) => e.status === "done").length;
  const failedCount = events.filter((e) => e.status === "failed").length;
  const analyzingEvent = events.find((e) => e.status === "analyzing");
  const progress = needAnalysis > 0 ? ((doneCount + failedCount) / needAnalysis) * 100 : 100;

  if (isComplete && needAnalysis === 0) return null;

  return (
    <div className="rounded-xl border border-deck-border bg-deck-card p-5">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          {isComplete ? (
            <CheckCircle className="h-5 w-5 text-emerald-400" />
          ) : (
            <Activity className="h-5 w-5 animate-pulse text-amber" />
          )}
          <h3 className="font-display font-semibold text-sand-50">
            {isComplete ? "Analyse terminée" : "Analyse audio en cours..."}
          </h3>
        </div>
        <span className="font-mono text-sm text-sand-300">
          {cached > 0 && !isComplete && (
            <span className="mr-2 text-amber">{cached} en cache</span>
          )}
          {doneCount + failedCount}/{needAnalysis}
        </span>
      </div>

      <div className="mb-4 h-1.5 overflow-hidden rounded-full bg-deck-surface">
        <div
          className="h-full rounded-full bg-gradient-to-r from-amber-dim to-amber transition-all duration-500 ease-out"
          style={{ width: `${Math.min(progress, 100)}%` }}
        />
      </div>

      {analyzingEvent && !isComplete && (
        <div className="mb-3 flex items-center gap-3 rounded-lg border border-amber/15 bg-amber/5 px-4 py-3">
          <div className="relative">
            <Music2 className="h-5 w-5 text-amber" />
            <span className="absolute -right-0.5 -top-0.5 h-2 w-2 animate-ping rounded-full bg-amber" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-sand-50">
              {analyzingEvent.name}
            </p>
            <p className="truncate text-xs text-sand-400">
              {analyzingEvent.artist}
            </p>
          </div>
          <Loader2 className="h-4 w-4 animate-spin text-amber" />
        </div>
      )}

      {events.length > 0 && (
        <div className="space-y-1">
          {events
            .filter((e) => e.status !== "analyzing")
            .slice(-6)
            .reverse()
            .map((event, i) => (
              <div
                key={`${event.track_id}-${i}`}
                className={`flex items-center gap-2.5 rounded-md px-3 py-1.5 text-sm transition-all duration-300 ${
                  i === 0 ? "bg-deck-surface" : "opacity-50"
                }`}
              >
                {event.status === "done" ? (
                  <CheckCircle className="h-3.5 w-3.5 flex-shrink-0 text-emerald-400" />
                ) : (
                  <XCircle className="h-3.5 w-3.5 flex-shrink-0 text-red-400" />
                )}
                <span className="min-w-0 flex-1 truncate">
                  <span className="text-sand-50">{event.name}</span>
                  <span className="mx-1 text-sand-500">—</span>
                  <span className="text-sand-300">{event.artist}</span>
                </span>
                {event.status === "done" && event.features && (
                  <div className="flex flex-shrink-0 items-center gap-2 font-mono text-xs text-sand-400">
                    <span>{Math.round(event.features.tempo)} BPM</span>
                    <span className="text-deck-muted">|</span>
                    <span>E: {Math.round(event.features.energy * 100)}%</span>
                  </div>
                )}
              </div>
            ))}
        </div>
      )}

      {!isComplete && needAnalysis > 5 && (
        <p className="mt-3 text-center text-xs text-sand-400">
          Analyse via Deezer + librosa · {needAnalysis - doneCount - failedCount} restants
        </p>
      )}
    </div>
  );
}
