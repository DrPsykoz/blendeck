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
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-spotify-green border-t-transparent" />
      </div>
    );
  }

  if (!isAuthenticated) return null;

  return (
    <div>
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Vos Playlists</h1>
          <p className="mt-1 text-spotify-light">
            Sélectionnez une playlist à analyser et trier
          </p>
        </div>
        <button
          onClick={logout}
          className="flex items-center gap-2 rounded-lg border border-spotify-gray px-4 py-2 text-sm text-spotify-light transition-colors hover:border-white hover:text-white"
        >
          <LogOut className="h-4 w-4" />
          Déconnexion
        </button>
      </div>

      {playlistsLoading && (
        <div className="flex items-center justify-center py-20">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-spotify-green border-t-transparent" />
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-red-400">
          Erreur: {(error as Error).message}
        </div>
      )}

      {playlists && (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {playlists.map((playlist: PlaylistSummary) => (
            <button
              key={playlist.id}
              onClick={() => router.push(`/playlist/${playlist.id}`)}
              className="group rounded-lg bg-spotify-gray/50 p-4 text-left transition-colors hover:bg-spotify-gray"
            >
              <div className="relative mb-3 aspect-square overflow-hidden rounded-md bg-spotify-black">
                {playlist.image_url ? (
                  <Image
                    src={playlist.image_url}
                    alt={playlist.name}
                    fill
                    className="object-cover transition-transform group-hover:scale-105"
                    sizes="200px"
                  />
                ) : (
                  <div className="flex h-full items-center justify-center">
                    <Music className="h-12 w-12 text-spotify-light/30" />
                  </div>
                )}
              </div>
              <h3 className="truncate font-semibold">{playlist.name}</h3>
              <p className="flex items-center gap-1 text-sm text-spotify-light">
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
