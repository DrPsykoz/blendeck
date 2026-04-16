import type { Metadata } from "next";
import "./globals.css";
import Providers from "./providers";

export const metadata: Metadata = {
  title: "Blendeck",
  description: "Transform your Spotify playlists into DJ-mixed sets",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="fr">
      <body className="min-h-screen bg-spotify-dark text-white antialiased">
        <Providers>
          <nav className="border-b border-spotify-gray bg-spotify-black px-6 py-4">
            <div className="mx-auto flex max-w-7xl items-center justify-between">
              <a href="/" className="flex items-center gap-2 text-xl font-bold">
                <span className="text-spotify-green">♫</span>
                <span>DJ Sorter</span>
              </a>
            </div>
          </nav>
          <main className="mx-auto max-w-7xl px-6 py-8">{children}</main>
        </Providers>
      </body>
    </html>
  );
}
