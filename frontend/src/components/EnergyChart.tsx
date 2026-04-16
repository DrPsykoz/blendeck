"use client";

import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  LineChart,
  Line,
} from "recharts";
import { Track, TransitionScore } from "@/lib/api";

interface EnergyChartProps {
  tracks: Track[];
  transitions?: TransitionScore[];
}

export default function EnergyChart({ tracks, transitions }: EnergyChartProps) {
  const data = tracks.map((track, i) => {
    const af = track.audio_features;
    const transition = transitions?.find((t) => t.to_track_id === track.id);
    return {
      name: `${i + 1}`,
      trackName: track.name.length > 20 ? track.name.slice(0, 20) + "…" : track.name,
      energy: af ? Math.round(af.energy * 100) : 0,
      bpm: af ? Math.round(af.tempo) : 0,
      danceability: af ? Math.round(af.danceability * 100) : 0,
      valence: af ? Math.round(af.valence * 100) : 0,
      transitionScore: transition ? Math.round(transition.total_score * 100) : null,
    };
  });

  const tooltipStyle = {
    backgroundColor: "#111114",
    border: "1px solid #242429",
    borderRadius: "10px",
    fontSize: 12,
    color: "#EDEAE5",
  };

  const tickStyle = { fill: "#5E5B65", fontSize: 11 };
  const gridColor = "#1A1A1E";

  return (
    <div className="rounded-xl border border-deck-border bg-deck-card p-4">
      <h3 className="mb-4 font-display text-sm font-semibold text-sand-300">
        Courbe d&apos;énergie &amp; BPM
      </h3>

      <div className="h-48">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 5, right: 10, left: -20, bottom: 5 }}>
            <defs>
              <linearGradient id="energyGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#D4A044" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#D4A044" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
            <XAxis dataKey="name" tick={tickStyle} />
            <YAxis tick={tickStyle} domain={[0, 100]} />
            <Tooltip
              contentStyle={tooltipStyle}
              labelFormatter={(label, payload) => {
                const item = payload?.[0]?.payload;
                return item?.trackName || `Track ${label}`;
              }}
            />
            <Area
              type="monotone"
              dataKey="energy"
              stroke="#D4A044"
              fill="url(#energyGrad)"
              strokeWidth={2}
              name="Énergie"
            />
            <Area
              type="monotone"
              dataKey="danceability"
              stroke="#60A5FA"
              fill="transparent"
              strokeWidth={1.5}
              strokeDasharray="4 4"
              name="Danceability"
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      <div className="mt-2 h-24">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 5, right: 10, left: -20, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
            <XAxis dataKey="name" tick={tickStyle} />
            <YAxis tick={tickStyle} />
            <Tooltip contentStyle={tooltipStyle} />
            <Line
              type="monotone"
              dataKey="bpm"
              stroke="#F87171"
              strokeWidth={2}
              dot={{ r: 2, fill: "#F87171" }}
              name="BPM"
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {transitions && transitions.length > 0 && (
        <div className="mt-2 h-20">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 5, right: 10, left: -20, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
              <XAxis dataKey="name" tick={tickStyle} />
              <YAxis tick={tickStyle} domain={[0, 100]} />
              <Tooltip contentStyle={tooltipStyle} />
              <Line
                type="monotone"
                dataKey="transitionScore"
                stroke="#34D399"
                strokeWidth={2}
                dot={{ r: 2, fill: "#34D399" }}
                name="Transition %"
                connectNulls
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
