"use client";

import { redirectToSpotifyAuth } from "@/lib/spotify-auth";
import { Music } from "lucide-react";

export default function LoginPage() {
  const handleLogin = async () => {
    await redirectToSpotifyAuth();
  };

  return (
    <div className="flex min-h-[70vh] flex-col items-center justify-center gap-8">
      <div className="text-center">
        <Music className="mx-auto mb-4 h-16 w-16 text-spotify-green" />
        <h1 className="mb-2 text-4xl font-bold">Blendeck</h1>
        <p className="text-lg text-spotify-light">
          Transformez vos playlists Spotify en sets DJ mixés
        </p>
      </div>

      <div className="max-w-md text-center text-spotify-light">
        <ul className="mb-6 space-y-2 text-left">
          <li>🎵 Tri par BPM, tonalité (Camelot), énergie</li>
          <li>🎛️ Détection des transitions idéales</li>
          <li>🎧 Génération automatique de mix MP3</li>
          <li>📤 Export en playlist Spotify, CSV ou JSON</li>
        </ul>
      </div>

      <button
        onClick={handleLogin}
        className="rounded-full bg-spotify-green px-8 py-3 text-lg font-semibold text-black transition-transform hover:scale-105 hover:brightness-110"
      >
        Se connecter avec Spotify
      </button>
    </div>
  );
}
