"use client";

import {
  ResponsiveContainer,
  ComposedChart,
  Area,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";
import { Track, TransitionScore } from "@/lib/api";
import { useState } from "react";

interface EnergyChartProps {
  tracks: Track[];
  transitions?: TransitionScore[];
}

type SeriesKey = "energy" | "bpm" | "danceability" | "valence" | "transitionScore" | "loudness" | "speechiness" | "acousticness" | "instrumentalness" | "liveness";

interface SeriesConfig {
  key: SeriesKey;
  label: string;
  color: string;
  yAxisId: "percent" | "bpm" | "loudness";
  defaultOn: boolean;
  dashed?: boolean;
  filled?: boolean;
}

const SERIES: SeriesConfig[] = [
  { key: "energy", label: "Énergie", color: "#D4A044", yAxisId: "percent", defaultOn: true, filled: true },
  { key: "bpm", label: "BPM", color: "#F87171", yAxisId: "bpm", defaultOn: true },
  { key: "danceability", label: "Dance", color: "#60A5FA", yAxisId: "percent", defaultOn: true, dashed: true },
  { key: "valence", label: "Mood", color: "#A78BFA", yAxisId: "percent", defaultOn: false, dashed: true },
  { key: "transitionScore", label: "Transition", color: "#34D399", yAxisId: "percent", defaultOn: false },
  { key: "loudness", label: "Volume", color: "#FB923C", yAxisId: "loudness", defaultOn: false },
  { key: "speechiness", label: "Voix", color: "#F472B6", yAxisId: "percent", defaultOn: false, dashed: true },
  { key: "acousticness", label: "Acoustique", color: "#2DD4BF", yAxisId: "percent", defaultOn: false, dashed: true },
  { key: "instrumentalness", label: "Instrumental", color: "#818CF8", yAxisId: "percent", defaultOn: false, dashed: true },
  { key: "liveness", label: "Live", color: "#FBBF24", yAxisId: "percent", defaultOn: false, dashed: true },
];

export default function EnergyChart({ tracks, transitions }: EnergyChartProps) {
  const [active, setActive] = useState<Set<SeriesKey>>(() =>
    new Set(SERIES.filter((s) => s.defaultOn).map((s) => s.key)),
  );

  const toggle = (key: SeriesKey) => {
    setActive((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const data = tracks.map((track, i) => {
    const af = track.audio_features;
    const transition = transitions?.find((t) => t.to_track_id === track.id);
    return {
      name: `${i + 1}`,
      trackName: track.name.length > 25 ? track.name.slice(0, 25) + "…" : track.name,
      energy: af ? Math.round(af.energy * 100) : null,
      bpm: af ? Math.round(af.tempo) : null,
      danceability: af ? Math.round(af.danceability * 100) : null,
      valence: af ? Math.round(af.valence * 100) : null,
      transitionScore: transition ? Math.round(transition.total_score * 100) : null,
      loudness: af ? Math.round(af.loudness + 60) : null, // shift -60..0 → 0..60
      speechiness: af ? Math.round(af.speechiness * 100) : null,
      acousticness: af ? Math.round(af.acousticness * 100) : null,
      instrumentalness: af ? Math.round(af.instrumentalness * 100) : null,
      liveness: af ? Math.round(af.liveness * 100) : null,
    };
  });

  const hasTransitions = transitions && transitions.length > 0;
  const showBpmAxis = active.has("bpm");
  const showLoudnessAxis = active.has("loudness");

  const tooltipStyle = {
    backgroundColor: "#111114",
    border: "1px solid #242429",
    borderRadius: "10px",
    fontSize: 12,
    color: "#EDEAE5",
  };

  const tickStyle = { fill: "#5E5B65", fontSize: 11 };
  const gridColor = "#1A1A1E";

  // Filter visible series
  const visibleSeries = SERIES.filter((s) => {
    if (s.key === "transitionScore" && !hasTransitions) return false;
    return active.has(s.key);
  });

  return (
    <div className="rounded-xl border border-deck-border bg-deck-card p-4">
      {/* Toggle buttons */}
      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        {SERIES.map((s) => {
          if (s.key === "transitionScore" && !hasTransitions) return null;
          const isOn = active.has(s.key);
          return (
            <button
              key={s.key}
              onClick={() => toggle(s.key)}
              className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-all ${
                isOn
                  ? "border-transparent bg-white/5"
                  : "border-deck-border text-sand-500 hover:text-sand-300"
              }`}
            >
              <span
                className="inline-block h-2 w-2 rounded-full"
                style={{ backgroundColor: isOn ? s.color : "#3a3a42" }}
              />
              {s.label}
            </button>
          );
        })}
      </div>

      {/* Chart */}
      <div className="h-52">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 5, right: showLoudnessAxis ? 40 : (showBpmAxis ? 40 : 10), left: -20, bottom: 5 }}>
            <defs>
              <linearGradient id="energyGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#D4A044" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#D4A044" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
            <XAxis dataKey="name" tick={tickStyle} />
            <YAxis yAxisId="percent" tick={tickStyle} domain={[0, 100]} />
            {showBpmAxis && (
              <YAxis yAxisId="bpm" orientation="right" tick={{ ...tickStyle, fill: "#F87171" }} />
            )}
            {showLoudnessAxis && !showBpmAxis && (
              <YAxis yAxisId="loudness" orientation="right" tick={{ ...tickStyle, fill: "#FB923C" }} domain={[0, 60]} />
            )}
            {showLoudnessAxis && showBpmAxis && (
              <YAxis yAxisId="loudness" hide domain={[0, 60]} />
            )}
            <Tooltip
              contentStyle={tooltipStyle}
              labelFormatter={(label, payload) => {
                const item = payload?.[0]?.payload;
                return item?.trackName || `Track ${label}`;
              }}
              formatter={((value: number, name: string, entry: { dataKey: string }) => {
                if (entry.dataKey === "bpm") return [`${value}`, name];
                if (entry.dataKey === "loudness") return [`${value - 60} dB`, name];
                return [`${value}%`, name];
              }) as never}
            />
            {visibleSeries.map((s) =>
              s.filled ? (
                <Area
                  key={s.key}
                  type="monotone"
                  dataKey={s.key}
                  yAxisId={s.yAxisId}
                  stroke={s.color}
                  fill="url(#energyGrad)"
                  strokeWidth={2}
                  name={s.label}
                  connectNulls
                />
              ) : (
                <Line
                  key={s.key}
                  type="monotone"
                  dataKey={s.key}
                  yAxisId={s.yAxisId}
                  stroke={s.color}
                  strokeWidth={s.dashed ? 1.5 : 2}
                  strokeDasharray={s.dashed ? "4 4" : undefined}
                  dot={{ r: 1.5, fill: s.color }}
                  name={s.label}
                  connectNulls
                />
              ),
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
