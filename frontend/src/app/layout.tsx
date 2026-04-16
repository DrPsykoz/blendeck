import type { Metadata } from "next";
import { Outfit, Manrope, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import Providers from "./providers";

const outfit = Outfit({
  subsets: ["latin"],
  variable: "--font-outfit",
  display: "swap",
});

const manrope = Manrope({
  subsets: ["latin"],
  variable: "--font-manrope",
  display: "swap",
});

const jetbrains = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains",
  display: "swap",
});

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
    <html lang="fr" className={`${outfit.variable} ${manrope.variable} ${jetbrains.variable}`}>
      <body className="min-h-screen bg-deck-bg font-sans text-sand-50 antialiased">
        <Providers>
          <nav className="sticky top-0 z-40 border-b border-deck-border/50 bg-deck-bg/80 backdrop-blur-xl">
            <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-3">
              <a href="/" className="group flex items-center gap-2.5">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber/10 transition-colors group-hover:bg-amber/20">
                  <span className="text-lg text-amber">♫</span>
                </div>
                <span className="font-display text-lg font-bold tracking-tight text-sand-50">
                  Blendeck
                </span>
              </a>
            </div>
          </nav>
          <main className="mx-auto max-w-7xl px-6 py-8">{children}</main>
        </Providers>
      </body>
    </html>
  );
}
