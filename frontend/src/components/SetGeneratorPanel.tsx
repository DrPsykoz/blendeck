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
    <div className="rounded-xl border border-deck-border bg-deck-card p-5">
      <h3 className="mb-4 flex items-center gap-2 font-display text-lg font-semibold text-sand-50">
        <Wand2 className="h-5 w-5 text-amber" />
        Générer un Set DJ
      </h3>

      <div className="mb-4">
        <label className="mb-2 block text-sm text-sand-300">Courbe d&apos;énergie</label>
        <div className="grid grid-cols-2 gap-2">
          {curves.map((c) => (
            <button
              key={c.value}
              onClick={() => setEnergyCurve(c.value)}
              className={`rounded-lg border px-3 py-2 text-left text-sm transition-all ${
                energyCurve === c.value
                  ? "border-amber/40 bg-amber/10 text-sand-50"
                  : "border-deck-border text-sand-300 hover:border-deck-muted"
              }`}
            >
              <div className="font-medium">{c.label}</div>
              <div className="text-xs text-sand-400">{c.desc}</div>
            </button>
          ))}
        </div>
      </div>

      <div className="mb-4 space-y-3">
        <div className="mb-1 flex items-center justify-between">
          <label className="text-sm text-sand-300">Poids des critères</label>
          <span className="text-[10px] text-sand-400">
            Normalisés automatiquement
          </span>
        </div>

        {[
          { label: "BPM", value: bpmWeight, set: setBpmWeight },
          { label: "Tonalité", value: keyWeight, set: setKeyWeight },
          { label: "Énergie", value: energyWeight, set: setEnergyWeight },
          { label: "Danceability", value: danceWeight, set: setDanceWeight },
          { label: "Année", value: yearWeight, set: setYearWeight },
        ].map((s) => (
          <div key={s.label} className="flex items-center gap-3">
            <span className="w-24 text-xs text-sand-300">{s.label}</span>
            <input
              type="range"
              min={0}
              max={100}
              value={s.value}
              onChange={(e) => s.set(Number(e.target.value))}
              className="flex-1"
            />
            <span className="w-8 text-right font-mono text-xs tabular-nums text-sand-400">
              {totalWeight > 0 ? Math.round((s.value / totalWeight) * 100) : 0}%
            </span>
          </div>
        ))}
      </div>

      <div className="mb-5">
        <div className="flex items-center gap-3">
          <span className="w-24 text-xs text-sand-300">Profondeur</span>
          <input
            type="range"
            min={1}
            max={10}
            value={beamWidth}
            onChange={(e) => setBeamWidth(Number(e.target.value))}
            className="flex-1"
          />
          <span className="w-8 text-right font-mono text-xs tabular-nums text-sand-400">
            {beamWidth}
          </span>
        </div>
        <p className="mt-1 text-[10px] text-sand-400">
          Plus élevé = meilleur résultat mais plus lent
        </p>
      </div>

      <button
        onClick={handleGenerate}
        disabled={isLoading}
        className="flex w-full items-center justify-center gap-2 rounded-full bg-amber px-6 py-2.5 font-display font-semibold text-deck-bg transition-all hover:bg-amber-light hover:shadow-lg hover:shadow-amber/20 active:scale-[0.98] disabled:opacity-50 disabled:hover:scale-100"
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
