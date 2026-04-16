"use client";

import { useState } from "react";
import { Wand2, Loader2 } from "lucide-react";

interface SetGeneratorPanelProps {
  onGenerate: (params: {
    energy_curve: string;
    bpm_weight: number;
    key_weight: number;
    energy_weight: number;
    danceability_weight: number;
    year_weight: number;
    beam_width: number;
  }) => void;
  isLoading: boolean;
}

export default function SetGeneratorPanel({ onGenerate, isLoading }: SetGeneratorPanelProps) {
  const [energyCurve, setEnergyCurve] = useState("arc");
  const [bpmWeight, setBpmWeight] = useState(25);
  const [keyWeight, setKeyWeight] = useState(25);
  const [energyWeight, setEnergyWeight] = useState(20);
  const [danceWeight, setDanceWeight] = useState(10);
  const [yearWeight, setYearWeight] = useState(20);
  const [beamWidth, setBeamWidth] = useState(5);

  const curves = [
    { value: "arc", label: "Arc ↗↘", desc: "Montée puis descente" },
    { value: "linear_up", label: "Montée ↗", desc: "Énergie croissante" },
    { value: "linear_down", label: "Descente ↘", desc: "Énergie décroissante" },
    { value: "plateau", label: "Plateau ➡", desc: "Énergie stable" },
  ];

  const handleGenerate = () => {
    const total = bpmWeight + keyWeight + energyWeight + danceWeight + yearWeight;
    const norm = total > 0 ? total : 1;
    onGenerate({
      energy_curve: energyCurve,
      bpm_weight: bpmWeight / norm,
      key_weight: keyWeight / norm,
      energy_weight: energyWeight / norm,
      danceability_weight: danceWeight / norm,
      year_weight: yearWeight / norm,
      beam_width: beamWidth,
    });
  };

  const totalWeight = bpmWeight + keyWeight + energyWeight + danceWeight + yearWeight;

  return (
    <div className="rounded-xl border border-spotify-gray bg-spotify-gray/30 p-5">
      <h3 className="mb-4 flex items-center gap-2 text-lg font-semibold">
        <Wand2 className="h-5 w-5 text-spotify-green" />
        Générer un Set DJ
      </h3>

      {/* Energy curve selection */}
      <div className="mb-4">
        <label className="mb-2 block text-sm text-spotify-light">Courbe d&apos;énergie</label>
        <div className="grid grid-cols-2 gap-2">
          {curves.map((c) => (
            <button
              key={c.value}
              onClick={() => setEnergyCurve(c.value)}
              className={`rounded-lg border px-3 py-2 text-left text-sm transition-colors ${
                energyCurve === c.value
                  ? "border-spotify-green bg-spotify-green/10 text-white"
                  : "border-spotify-gray text-spotify-light hover:border-white/30"
              }`}
            >
              <div className="font-medium">{c.label}</div>
              <div className="text-xs opacity-60">{c.desc}</div>
            </button>
          ))}
        </div>
      </div>

      {/* Weight sliders */}
      <div className="mb-4 space-y-3">
        <div className="mb-1 flex items-center justify-between">
          <label className="text-sm text-spotify-light">Poids des critères</label>
          <span className="text-[10px] text-spotify-light/50">
            Les poids sont normalisés automatiquement
          </span>
        </div>

        {[
          { label: "BPM", value: bpmWeight, set: setBpmWeight, color: "accent-red-500" },
          { label: "Tonalité", value: keyWeight, set: setKeyWeight, color: "accent-blue-500" },
          { label: "Énergie", value: energyWeight, set: setEnergyWeight, color: "accent-green-500" },
          { label: "Danceability", value: danceWeight, set: setDanceWeight, color: "accent-yellow-500" },
          { label: "Année", value: yearWeight, set: setYearWeight, color: "accent-purple-500" },
        ].map((s) => (
          <div key={s.label} className="flex items-center gap-3">
            <span className="w-24 text-xs text-spotify-light">{s.label}</span>
            <input
              type="range"
              min={0}
              max={100}
              value={s.value}
              onChange={(e) => s.set(Number(e.target.value))}
              className={`h-1.5 flex-1 cursor-pointer appearance-none rounded-full bg-spotify-gray ${s.color}`}
            />
            <span className="w-8 text-right text-xs tabular-nums text-spotify-light">
              {totalWeight > 0 ? Math.round((s.value / totalWeight) * 100) : 0}%
            </span>
          </div>
        ))}
      </div>

      {/* Beam width */}
      <div className="mb-5">
        <div className="flex items-center gap-3">
          <span className="w-24 text-xs text-spotify-light">Profondeur</span>
          <input
            type="range"
            min={1}
            max={10}
            value={beamWidth}
            onChange={(e) => setBeamWidth(Number(e.target.value))}
            className="h-1.5 flex-1 cursor-pointer appearance-none rounded-full bg-spotify-gray accent-spotify-green"
          />
          <span className="w-8 text-right text-xs tabular-nums text-spotify-light">
            {beamWidth}
          </span>
        </div>
        <p className="mt-1 text-[10px] text-spotify-light/50">
          Plus élevé = meilleur résultat mais plus lent
        </p>
      </div>

      <button
        onClick={handleGenerate}
        disabled={isLoading}
        className="flex w-full items-center justify-center gap-2 rounded-full bg-spotify-green px-6 py-2.5 font-semibold text-black transition-transform hover:scale-[1.02] hover:brightness-110 disabled:opacity-50 disabled:hover:scale-100"
      >
        {isLoading ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            Génération...
          </>
        ) : (
          <>
            <Wand2 className="h-4 w-4" />
            Générer le set
          </>
        )}
      </button>
    </div>
  );
}
