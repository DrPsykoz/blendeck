import logging
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from core.config import get_settings
from routers import auth, playlists, sort, export

logging.basicConfig(level=logging.INFO)
settings = get_settings()

app = FastAPI(
    title="Blendeck",
    description="Transform your Spotify playlists into DJ-mixed sets",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=(
        [settings.frontend_url, "http://localhost:3000", "http://127.0.0.1:3000"]
        if any(h in settings.frontend_url for h in ("localhost", "127.0.0.1"))
        else [settings.frontend_url]
    ),
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
)

app.include_router(auth.router)
app.include_router(playlists.router)
app.include_router(sort.router)
app.include_router(export.router)


@app.get("/api/health")
async def health():
    return {"status": "ok"}
