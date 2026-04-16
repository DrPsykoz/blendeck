# Blendeck — Copilot Instructions

## Overview
Blendeck transforms Spotify playlists into DJ-mixed sets. It analyzes audio features (BPM, key, energy), sorts tracks for optimal transitions, and generates full MP3 mixes with crossfades.

**Repo:** github.com/DrPsykoz/blendeck.git (branch: main)

## Stack

### Backend (`/backend`)
- **Python 3.11**, FastAPI 0.115, uvicorn
- **Audio:** librosa 0.10.2 (analysis), yt-dlp (download), ffmpeg (mix), ytmusicapi (search)
- **HTTP:** httpx 0.28.1 (async)
- **Config:** pydantic-settings, `.env` file
- **Storage:** JSON flat files in `/app/cache/` (audio_features.json, preview_urls.json, track_meta.json, history.json), MP3s in `/app/cache/tracks/` and `/app/cache/mixes/`

### Frontend (`/frontend`)
- **Next.js 14**, React 18, TypeScript
- **Styling:** TailwindCSS, custom spotify-* color tokens in tailwind.config.js
- **Data:** @tanstack/react-query, SSE for progress streams
- **UI:** lucide-react icons, recharts, @dnd-kit (drag & drop)

### Infrastructure
- Docker Compose: `dj-backend` (port 8000) + `dj-frontend` (port 3000)
- Volume `audio-cache` at `/app/cache`
- Both containers run as non-root `appuser`
- No `--reload` in production

## Architecture Patterns

### Authentication
- **Spotify OAuth PKCE** (S256)
- **Refresh token** → httpOnly secure cookie (set by `/api/auth/token`, refreshed by `/api/auth/refresh`)
- **Access token** → in-memory only (`let _accessToken` in `spotify-auth.ts`), NOT in localStorage
- Backend proxy in `routers/auth.py` handles token exchange/refresh with Spotify
- All API endpoints require `Authorization: Bearer <token>` header

### API Communication
- `apiFetch<T>()` in `lib/api.ts` — central authenticated fetch wrapper
- SSE (Server-Sent Events) for long operations: playlist analysis, mix generation
- SSE pattern: `event: type\ndata: JSON\n\n` — types: start, progress, complete, error
- Backend SSE uses `StreamingResponse` + asyncio task + progress callback list

### Security Rules (MUST follow)
- **SSRF prevention:** validate preview URLs against allowlist before any outbound request
- **Path traversal:** validate all IDs (track, playlist) with `^[a-zA-Z0-9]{1,32}$`
- **Auth required:** every endpoint that accesses user data or triggers processing must check Authorization header
- **CORS:** only allow frontend_url; localhost origins only when frontend_url is localhost
- **Rate limiting:** use asyncio.Semaphore for expensive operations
- **Error messages:** never send raw exception messages to client in SSE/API responses
- **Docker:** non-root user, no --reload, no source volume mount in production
- **No localStorage for tokens** — refresh token in httpOnly cookie, access token in memory only
- **ffmpeg:** never interpolate user strings into filter_complex — use allowlisted values only

### Audio Features
- Spotify Audio Features API is **deprecated** (403 since Nov 2024)
- Fallback: Spotify cache → Deezer API (BPM) → librosa analysis from preview audio
- Camelot wheel key notation for DJ mixing

## Conventions
- Language: French for UI strings and comments
- Backend: type hints, `_extract_token()` helper in each router, Pydantic models in `models/track.py`
- Frontend: `"use client"` on interactive components, barrel exports not used
- Naming: kebab-case routes, snake_case Python, camelCase TypeScript
- Build: `docker compose up --build -d`, validate Python syntax before deploying
- Spotify redirect URI must use `127.0.0.1` not `localhost`
