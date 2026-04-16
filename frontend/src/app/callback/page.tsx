"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { exchangeCode, saveTokens } from "@/lib/spotify-auth";
import { useAuth } from "@/app/providers";

export default function CallbackPage() {
  const router = useRouter();
  const { refreshAuth } = useAuth();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    const errorParam = params.get("error");

    if (errorParam) {
      setError(`Spotify a refusé l'accès: ${errorParam}`);
      return;
    }

    if (!code) {
      setError("Code d'autorisation manquant");
      return;
    }

    exchangeCode(code)
      .then((data) => {
        saveTokens(data.access_token, data.refresh_token, data.expires_in);
        refreshAuth().then(() => router.replace("/"));
      })
      .catch((err) => {
        setError(`Erreur d'authentification: ${err.message}`);
      });
  }, [router, refreshAuth]);

  if (error) {
    return (
      <div className="flex min-h-[50vh] flex-col items-center justify-center gap-4">
        <p className="text-red-400">{error}</p>
        <a href="/login" className="text-spotify-green underline">
          Réessayer
        </a>
      </div>
    );
  }

  return (
    <div className="flex min-h-[50vh] items-center justify-center">
      <div className="text-center">
        <div className="mb-4 h-8 w-8 animate-spin rounded-full border-2 border-spotify-green border-t-transparent mx-auto" />
        <p className="text-spotify-light">Connexion en cours...</p>
      </div>
    </div>
  );
}
