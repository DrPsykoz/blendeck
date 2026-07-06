---
name: run-blendeck
description: Lancer Blendeck en local (Docker Compose ou mode dev sans Docker) — prérequis env, ports, health checks. Utiliser pour démarrer, tester ou vérifier l'app.
---

# Lancer Blendeck

## Prérequis

- `backend/.env` doit exister avec `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET`, `SPOTIFY_REDIRECT_URI=http://localhost:3000/callback`, `FRONTEND_URL=http://localhost:3000` (copier depuis `backend/.env.example`).
- `frontend/.env.local` avec `NEXT_PUBLIC_SPOTIFY_CLIENT_ID`, `NEXT_PUBLIC_REDIRECT_URI`, `NEXT_PUBLIC_API_URL=http://localhost:8000`.
- ffmpeg requis en mode dev sans Docker.

## Docker (voie normale)

```bash
docker compose up -d --build
docker compose logs -f          # suivre les logs
docker compose down             # arrêter
```

Frontend sur http://localhost:3000, backend sur http://localhost:8000. Le cache audio persiste dans le volume `blendeck_audio_cache`.

## Mode dev sans Docker

```bash
# Backend (port 8000) — un seul worker obligatoire (état en mémoire)
cd backend && source venv/bin/activate 2>/dev/null || python -m venv venv && source venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000

# Frontend (port 3000)
cd frontend && npm install && npm run dev
```

## Tests backend

Pas de Python 3.11 sur la machine locale (3.9 seulement) — lancer pytest dans Docker :

```bash
docker run --rm -v ./backend:/w -w /w -e CACHE_DIR=/tmp/cache python:3.11-slim \
  bash -c "pip install -q pytest numpy pydantic pydantic-settings yt-dlp ytmusicapi httpx fastapi && python -m pytest tests"
```

## Vérification

- Health check backend : `curl http://localhost:8000/api/health` → `{"status":"ok"}`
- L'auth complète exige un vrai compte Spotify (PKCE) ; sans login, seul le health check et les endpoints preview sont testables.
- Le téléchargement YouTube peut échouer sur IP datacenter sans `cookies.txt` (Netscape) dans `/app/cache/cookies.txt`.
