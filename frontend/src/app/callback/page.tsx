"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { exchangeCode } from "@/lib/spotify-auth";
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
      .then(() => {
        refreshAuth().then(() => router.replace("/"));
      })
      .catch((err) => {
        setError(`Erreur d'authentification: ${err.message}`);
      });
  }, [router, refreshAuth]);

  if (error) {
    return (
      <div className="flex min-h-[50vh] flex-col items-center justify-center gap-4">
        <div className="rounded-xl border border-red-500/20 bg-red-500/5 px-6 py-4 text-center">
          <p className="text-red-400">{error}</p>
          <a href="/login" className="mt-3 inline-block text-sm text-amber underline hover:text-amber-light">
            Réessayer
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-[50vh] items-center justify-center">
      <div className="text-center animate-fade-in">
        <div className="mb-4 mx-auto h-8 w-8 animate-spin rounded-full border-2 border-amber border-t-transparent" />
        <p className="text-sand-300">Connexion en cours...</p>
      </div>
    </div>
  );
}
