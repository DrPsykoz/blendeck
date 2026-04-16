"use client";

import { useAuth } from "@/app/providers";
import { useQuery } from "@tanstack/react-query";
import { fetchPlaylists, PlaylistSummary } from "@/lib/api";
import { useRouter } from "next/navigation";
import { LogOut, Music, ListMusic } from "lucide-react";
import Image from "next/image";
import { useEffect } from "react";

export default function HomePage() {
  const { isAuthenticated, isLoading, logout } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.replace("/login");
    }
  }, [isLoading, isAuthenticated, router]);

  const { data: playlists, isLoading: playlistsLoading, error } = useQuery({
    queryKey: ["playlists"],
    queryFn: fetchPlaylists,
    enabled: isAuthenticated,
  });

  if (isLoading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-amber border-t-transparent" />
      </div>
    );
  }

  if (!isAuthenticated) return null;

  return (
    <div className="animate-fade-in">
      <div className="mb-10 flex items-end justify-between">
        <div>
          <h1 className="font-display text-3xl font-bold tracking-tight text-sand-50">
            Vos Playlists
          </h1>
          <p className="mt-1.5 text-sm text-sand-300">
            Sélectionnez une playlist à analyser et trier
          </p>
        </div>
        <button
          onClick={logout}
          className="flex items-center gap-2 rounded-lg border border-deck-border px-3.5 py-2 text-sm text-sand-300 transition-all hover:border-sand-400 hover:text-sand-50"
        >
          <LogOut className="h-3.5 w-3.5" />
          Déconnexion
        </button>
      </div>

      {playlistsLoading && (
        <div className="flex items-center justify-center py-20">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-amber border-t-transparent" />
        </div>
      )}

      {error && (
        <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-4 text-sm text-red-400">
          Erreur: {(error as Error).message}
        </div>
      )}

      {playlists && (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {playlists.map((playlist: PlaylistSummary, i: number) => (
            <button
              key={playlist.id}
              onClick={() => router.push(`/playlist/${playlist.id}`)}
              className="group animate-fade-in-up rounded-xl border border-deck-border bg-deck-card p-3.5 text-left transition-all hover:border-deck-muted hover:bg-deck-surface hover:shadow-lg hover:shadow-black/20"
              style={{ animationDelay: `${Math.min(i * 0.04, 0.4)}s` }}
            >
              <div className="relative mb-3 aspect-square overflow-hidden rounded-lg bg-deck-surface">
                {playlist.image_url ? (
                  <Image
                    src={playlist.image_url}
                    alt={playlist.name}
                    fill
                    className="object-cover transition-transform duration-300 group-hover:scale-105"
                    sizes="200px"
                  />
                ) : (
                  <div className="flex h-full items-center justify-center">
                    <Music className="h-10 w-10 text-sand-500" />
                  </div>
                )}
                {/* Hover overlay */}
                <div className="absolute inset-0 flex items-center justify-center bg-black/0 transition-all group-hover:bg-black/30">
                  <div className="flex h-10 w-10 scale-0 items-center justify-center rounded-full bg-amber text-deck-bg transition-transform group-hover:scale-100">
                    <Music className="h-4 w-4" />
                  </div>
                </div>
              </div>
              <h3 className="truncate text-sm font-semibold text-sand-50">{playlist.name}</h3>
              <p className="mt-0.5 flex items-center gap-1 text-xs text-sand-400">
                <ListMusic className="h-3 w-3" />
                {playlist.track_count} titres
              </p>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
