from __future__ import annotations

import os
from pathlib import Path

# Single source of truth for the on-disk cache layout.
# CACHE_DIR defaults to the Docker volume mount point; tests and bare-metal
# dev override it via the environment.
CACHE_ROOT = Path(os.getenv("CACHE_DIR", "/app/cache"))

TRACKS_DIR = CACHE_ROOT / "tracks"
MIXES_DIR = CACHE_ROOT / "mixes"
TRIMMED_DIR = CACHE_ROOT / "trimmed"
PREVIEWS_DIR = CACHE_ROOT / "previews"
TRANSITIONS_DIR = CACHE_ROOT / "transitions"

DEFAULT_COOKIES_PATH = CACHE_ROOT / "cookies.txt"


def ensure_cache_dirs() -> None:
    for d in (TRACKS_DIR, MIXES_DIR, TRIMMED_DIR, PREVIEWS_DIR, TRANSITIONS_DIR):
        d.mkdir(parents=True, exist_ok=True)


ensure_cache_dirs()
