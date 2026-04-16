from __future__ import annotations
import json
import logging
import os
from pathlib import Path

from models.track import AudioFeatures

logger = logging.getLogger(__name__)

CACHE_DIR = Path(os.getenv("CACHE_DIR", "/app/cache"))
CACHE_FILE = CACHE_DIR / "audio_features.json"
PREVIEW_FILE = CACHE_DIR / "preview_urls.json"

_memory_cache: dict[str, AudioFeatures] = {}
_preview_cache: dict[str, str] = {}
_track_meta: dict[str, dict[str, str]] = {}  # track_id -> {"name": ..., "artist": ...}
_loaded = False


def _ensure_dir() -> None:
    CACHE_DIR.mkdir(parents=True, exist_ok=True)


def _load_from_disk() -> None:
    global _loaded
    if _loaded:
        return
    _loaded = True
    if not CACHE_FILE.exists():
        return
    try:
        with open(CACHE_FILE, "r") as f:
            data = json.load(f)
        for track_id, feats in data.items():
            _memory_cache[track_id] = AudioFeatures(**feats)
        logger.info(f"Loaded {len(_memory_cache)} cached audio features from disk")
    except Exception as e:
        logger.warning(f"Failed to load features cache: {e}")
    try:
        if PREVIEW_FILE.exists():
            with open(PREVIEW_FILE, "r") as f:
                _preview_cache.update(json.load(f))
            logger.info(f"Loaded {len(_preview_cache)} cached preview URLs")
    except Exception as e:
        logger.warning(f"Failed to load preview cache: {e}")
    meta_file = CACHE_DIR / "track_meta.json"
    try:
        if meta_file.exists():
            with open(meta_file, "r") as f:
                _track_meta.update(json.load(f))
    except Exception as e:
        logger.warning(f"Failed to load track meta cache: {e}")


def _save_to_disk() -> None:
    _ensure_dir()
    try:
        data = {}
        for track_id, af in _memory_cache.items():
            data[track_id] = {
                "tempo": af.tempo,
                "key": af.key,
                "mode": af.mode,
                "energy": af.energy,
                "danceability": af.danceability,
                "valence": af.valence,
                "loudness": af.loudness,
                "acousticness": af.acousticness,
                "instrumentalness": af.instrumentalness,
                "speechiness": af.speechiness,
                "liveness": af.liveness,
                "duration_ms": af.duration_ms,
                "time_signature": af.time_signature,
            }
        with open(CACHE_FILE, "w") as f:
            json.dump(data, f)
    except Exception as e:
        logger.error(f"Failed to save features cache: {e}")
    try:
        with open(PREVIEW_FILE, "w") as f:
            json.dump(_preview_cache, f)
    except Exception as e:
        logger.error(f"Failed to save preview cache: {e}")
    try:
        meta_file = CACHE_DIR / "track_meta.json"
        with open(meta_file, "w") as f:
            json.dump(_track_meta, f)
    except Exception as e:
        logger.error(f"Failed to save track meta cache: {e}")


def get_cached(track_id: str) -> AudioFeatures | None:
    _load_from_disk()
    return _memory_cache.get(track_id)


def get_cached_many(track_ids: list[str]) -> dict[str, AudioFeatures]:
    _load_from_disk()
    return {tid: _memory_cache[tid] for tid in track_ids if tid in _memory_cache}


def set_cached(track_id: str, features: AudioFeatures) -> None:
    _load_from_disk()
    _memory_cache[track_id] = features


def get_preview_url(track_id: str) -> str | None:
    _load_from_disk()
    return _preview_cache.get(track_id)


def set_preview_url(track_id: str, url: str) -> None:
    _load_from_disk()
    _preview_cache[track_id] = url


def get_track_meta(track_id: str) -> tuple[str, str] | None:
    """Return (name, artist) for a track, or None."""
    _load_from_disk()
    meta = _track_meta.get(track_id)
    if meta:
        return meta.get("name", ""), meta.get("artist", "")
    return None


def set_track_meta(track_id: str, name: str, artist: str) -> None:
    _load_from_disk()
    _track_meta[track_id] = {"name": name, "artist": artist}


def save() -> None:
    """Persist all cached features to disk."""
    _save_to_disk()


def uncached_ids(track_ids: list[str]) -> list[str]:
    """Return IDs not yet in cache."""
    _load_from_disk()
    return [tid for tid in track_ids if tid not in _memory_cache]
