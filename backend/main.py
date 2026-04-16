import logging
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from core.config import get_settings
from routers import playlists, sort, export

logging.basicConfig(level=logging.INFO)
settings = get_settings()

app = FastAPI(
    title="Blendeck",
    description="Transform your Spotify playlists into DJ-mixed sets",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.frontend_url, "http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(playlists.router)
app.include_router(sort.router)
app.include_router(export.router)


@app.get("/api/health")
async def health():
    return {"status": "ok"}
