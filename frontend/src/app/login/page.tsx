"use client";

import { redirectToSpotifyAuth } from "@/lib/spotify-auth";
import { Music, Disc3, Headphones, Radio } from "lucide-react";

export default function LoginPage() {
  const handleLogin = async () => {
    await redirectToSpotifyAuth();
  };

  return (
    <div className="flex min-h-[80vh] flex-col items-center justify-center">
      {/* Ambient glow */}
      <div className="pointer-events-none absolute left-1/2 top-1/3 -translate-x-1/2 -translate-y-1/2">
        <div className="h-[400px] w-[600px] rounded-full bg-amber/5 blur-[120px]" />
      </div>

      <div className="relative animate-fade-in-up text-center">
        {/* Logo mark */}
        <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-2xl border border-deck-border bg-deck-card shadow-lg shadow-amber/5">
          <Disc3 className="h-10 w-10 text-amber" />
        </div>

        <h1 className="mb-2 font-display text-5xl font-bold tracking-tight text-sand-50">
          Blendeck
        </h1>
        <p className="mx-auto max-w-sm text-lg text-sand-300">
          Transformez vos playlists Spotify en sets DJ mixés
        </p>
      </div>

      <div className="relative mt-12 grid w-full max-w-lg grid-cols-2 gap-3 animate-fade-in-up" style={{ animationDelay: "0.15s" }}>
        {[
          { icon: Music, label: "Tri intelligent", desc: "BPM, tonalité Camelot, énergie" },
          { icon: Radio, label: "Transitions", desc: "Détection des enchaînements idéaux" },
          { icon: Headphones, label: "Mix MP3", desc: "Génération automatique avec crossfade" },
          { icon: Disc3, label: "Export", desc: "Playlist Spotify, CSV ou JSON" },
        ].map((feature) => (
          <div
            key={feature.label}
            className="rounded-xl border border-deck-border bg-deck-card/60 p-4 transition-colors hover:border-deck-muted"
          >
            <feature.icon className="mb-2 h-5 w-5 text-amber" />
            <div className="text-sm font-semibold text-sand-50">{feature.label}</div>
            <div className="mt-0.5 text-xs text-sand-400">{feature.desc}</div>
          </div>
        ))}
      </div>

      <button
        onClick={handleLogin}
        className="relative mt-10 animate-fade-in-up rounded-full bg-amber px-10 py-3.5 font-display text-base font-semibold text-deck-bg transition-all hover:bg-amber-light hover:shadow-lg hover:shadow-amber/20 active:scale-[0.98]"
        style={{ animationDelay: "0.3s" }}
      >
        Se connecter avec Spotify
      </button>

      <p className="mt-4 animate-fade-in text-xs text-sand-400" style={{ animationDelay: "0.4s" }}>
        Connexion sécurisée via Spotify OAuth
      </p>
    </div>
  );
}
