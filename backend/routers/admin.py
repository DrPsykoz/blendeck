from __future__ import annotations

import json
import re
import shutil
from pathlib import Path

from fastapi import APIRouter, Header, HTTPException, Query
from fastapi.responses import FileResponse
from pydantic import BaseModel

from core.config import get_settings
from services.spotify import get_current_user_profile

router = APIRouter(prefix="/api/admin", tags=["admin"])
settings = get_settings()

CACHE_ROOT = Path("/app/cache")
TRACKS_DIR = CACHE_ROOT / "tracks"
PREVIEWS_DIR = CACHE_ROOT / "previews"
MIXES_DIR = CACHE_ROOT / "mixes"
TRANSITIONS_DIR = CACHE_ROOT / "transitions"

ROOT_METADATA_FILES = [
    CACHE_ROOT / "audio_features.json",
    CACHE_ROOT / "preview_urls.json",
    CACHE_ROOT / "track_meta.json",
    CACHE_ROOT / "history.json",
]
MIX_HISTORY_FILE = MIXES_DIR / "history.json"
TRACK_META_FILE = CACHE_ROOT / "track_meta.json"


def _extract_token(authorization: str | None) -> str:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing or invalid token")
    return authorization.removeprefix("Bearer ").strip()


async def _require_admin(authorization: str | None) -> dict:
    token = _extract_token(authorization)
    try:
        user = await get_current_user_profile(token)
    except Exception:
        raise HTTPException(status_code=401, detail="Unable to fetch user profile")

    email = (user.get("email") or "").strip().lower()
    if email != settings.admin_email.strip().lower():
        raise HTTPException(status_code=403, detail="Admin access required")
    return user


def _bytes_to_mb(size_bytes: int) -> float:
    return round(size_bytes / (1024 * 1024), 2)


def _dir_stats(path: Path, recent_limit: int = 15) -> dict:
    if not path.exists():
        return {
            "exists": False,
            "files": 0,
            "size_bytes": 0,
            "size_mb": 0.0,
            "recent_files": [],
        }

    files: list[Path] = [p for p in path.rglob("*") if p.is_file()]
    total_size = sum(p.stat().st_size for p in files)
    recent = sorted(files, key=lambda p: p.stat().st_mtime, reverse=True)[:recent_limit]

    return {
        "exists": True,
        "files": len(files),
        "size_bytes": total_size,
        "size_mb": _bytes_to_mb(total_size),
        "recent_files": [
            {
                "name": p.name,
                "size_bytes": p.stat().st_size,
                "size_mb": _bytes_to_mb(p.stat().st_size),
                "path": str(p.relative_to(CACHE_ROOT)),
            }
            for p in recent
        ],
    }


def _metadata_stats() -> dict:
    existing = [p for p in ROOT_METADATA_FILES + [MIX_HISTORY_FILE] if p.exists()]
    total_size = sum(p.stat().st_size for p in existing)
    return {
        "files": len(existing),
        "size_bytes": total_size,
        "size_mb": _bytes_to_mb(total_size),
        "items": [
            {
                "name": p.name,
                "size_bytes": p.stat().st_size,
                "size_mb": _bytes_to_mb(p.stat().st_size),
                "path": str(p.relative_to(CACHE_ROOT)),
            }
            for p in existing
        ],
    }


def _load_track_meta() -> dict[str, dict[str, str]]:
    if not TRACK_META_FILE.exists():
        return {}
    try:
        with open(TRACK_META_FILE, "r") as f:
            data = json.load(f)
        if isinstance(data, dict):
            return data
    except Exception:
        return {}
    return {}


def _delete_dir_contents(path: Path) -> dict:
    if not path.exists():
        return {"deleted_files": 0, "freed_bytes": 0, "freed_mb": 0.0}

    deleted_files = 0
    freed_bytes = 0

    for item in path.rglob("*"):
        if item.is_file():
            try:
                size = item.stat().st_size
                item.unlink(missing_ok=True)
                deleted_files += 1
                freed_bytes += size
            except Exception:
                continue

    # Remove empty subdirectories, keep root directory intact.
    for item in sorted(path.rglob("*"), reverse=True):
        if item.is_dir():
            try:
                item.rmdir()
            except OSError:
                continue

    return {
        "deleted_files": deleted_files,
        "freed_bytes": freed_bytes,
        "freed_mb": _bytes_to_mb(freed_bytes),
    }


def _delete_metadata_files() -> dict:
    deleted_files = 0
    freed_bytes = 0
    for path in ROOT_METADATA_FILES + [MIX_HISTORY_FILE]:
        if not path.exists():
            continue
        try:
            size = path.stat().st_size
            path.unlink(missing_ok=True)
            deleted_files += 1
            freed_bytes += size
        except Exception:
            continue
    return {
        "deleted_files": deleted_files,
        "freed_bytes": freed_bytes,
        "freed_mb": _bytes_to_mb(freed_bytes),
    }


@router.get("/cache/overview")
async def admin_cache_overview(authorization: str = Header()):
    user = await _require_admin(authorization)
    tracks = _dir_stats(TRACKS_DIR)
    mixes = _dir_stats(MIXES_DIR)
    transitions = _dir_stats(TRANSITIONS_DIR)
    metadata = _metadata_stats()

    total_bytes = (
        tracks["size_bytes"] + mixes["size_bytes"] + transitions["size_bytes"] + metadata["size_bytes"]
    )

    return {
        "admin_email": user.get("email"),
        "cache_root": str(CACHE_ROOT),
        "tracks": tracks,
        "mixes": mixes,
        "transitions": transitions,
        "metadata": metadata,
        "total": {
            "size_bytes": total_bytes,
            "size_mb": _bytes_to_mb(total_bytes),
        },
    }


@router.delete("/cache")
async def admin_clear_cache(
    authorization: str = Header(),
    scope: str = Query("all", pattern=r"^(tracks|mixes|transitions|metadata|all)$"),
):
    await _require_admin(authorization)

    result = {
        "scope": scope,
        "tracks": {"deleted_files": 0, "freed_bytes": 0, "freed_mb": 0.0},
        "mixes": {"deleted_files": 0, "freed_bytes": 0, "freed_mb": 0.0},
        "transitions": {"deleted_files": 0, "freed_bytes": 0, "freed_mb": 0.0},
        "metadata": {"deleted_files": 0, "freed_bytes": 0, "freed_mb": 0.0},
    }

    if scope in ("tracks", "all"):
        result["tracks"] = _delete_dir_contents(TRACKS_DIR)
    if scope in ("mixes", "all"):
        result["mixes"] = _delete_dir_contents(MIXES_DIR)
    if scope in ("transitions", "all"):
        result["transitions"] = _delete_dir_contents(TRANSITIONS_DIR)
    if scope in ("metadata", "all"):
        result["metadata"] = _delete_metadata_files()

    total_freed = (
        result["tracks"]["freed_bytes"]
        + result["mixes"]["freed_bytes"]
        + result["transitions"]["freed_bytes"]
        + result["metadata"]["freed_bytes"]
    )
    result["total"] = {
        "freed_bytes": total_freed,
        "freed_mb": _bytes_to_mb(total_freed),
    }

    return result


@router.delete("/cache/tracks/{track_id}")
async def admin_delete_track_cache(
    track_id: str,
    authorization: str = Header(),
    source: str = Query("auto", pattern=r"^(auto|tracks|previews)$"),
):
    await _require_admin(authorization)

    if not track_id.isalnum() or len(track_id) > 64:
        raise HTTPException(status_code=400, detail="Invalid track ID")

    candidates: list[tuple[str, Path]] = []
    if source in ("auto", "tracks"):
        candidates.append(("tracks", TRACKS_DIR / f"{track_id}.mp3"))
    if source in ("auto", "previews"):
        candidates.append(("previews", PREVIEWS_DIR / f"{track_id}.mp3"))

    file_source = None
    file_path: Path | None = None
    for candidate_source, candidate_path in candidates:
        if candidate_path.exists():
            file_source = candidate_source
            file_path = candidate_path
            break

    if file_path is None:
        return {
            "track_id": track_id,
            "source": source,
            "deleted": False,
            "message": "File not found",
        }

    size = file_path.stat().st_size
    file_path.unlink(missing_ok=True)
    return {
        "track_id": track_id,
        "source": file_source,
        "deleted": True,
        "freed_bytes": size,
        "freed_mb": _bytes_to_mb(size),
    }


@router.get("/cache/tracks")
async def admin_list_cached_tracks(
    authorization: str = Header(),
    q: str = Query("", max_length=100),
    limit: int = Query(200, ge=1, le=1000),
):
    await _require_admin(authorization)

    meta = _load_track_meta()
    files: list[tuple[str, Path]] = []
    files.extend(("tracks", p) for p in TRACKS_DIR.glob("*.mp3") if p.is_file())
    files.extend(("previews", p) for p in PREVIEWS_DIR.glob("*.mp3") if p.is_file())
    files = sorted(files, key=lambda item: item[1].stat().st_mtime, reverse=True)

    needle = q.strip().lower()
    items = []
    for source, path in files:
        track_id = path.stem
        track_meta = meta.get(track_id, {}) if isinstance(meta.get(track_id), dict) else {}
        name = str(track_meta.get("name", ""))
        artist = str(track_meta.get("artist", ""))
        search_blob = f"{track_id} {name} {artist}".lower()
        if needle and needle not in search_blob:
            continue

        size_bytes = path.stat().st_size
        items.append(
            {
                "track_id": track_id,
                "source": source,
                "name": name or None,
                "artist": artist or None,
                "file_name": path.name,
                "size_bytes": size_bytes,
                "size_mb": _bytes_to_mb(size_bytes),
                "updated_at": int(path.stat().st_mtime),
                "stream_path": f"/api/admin/cache/tracks/{track_id}/stream?source={source}",
            }
        )
        if len(items) >= limit:
            break

    return {
        "total_files": len(files),
        "returned": len(items),
        "items": items,
    }


@router.get("/cache/tracks/{track_id}/stream")
async def admin_stream_cached_track(
    track_id: str,
    authorization: str = Header(),
    source: str = Query("auto", pattern=r"^(auto|tracks|previews)$"),
):
    await _require_admin(authorization)

    if not track_id.isalnum() or len(track_id) > 64:
        raise HTTPException(status_code=400, detail="Invalid track ID")

    candidates: list[Path] = []
    if source in ("auto", "tracks"):
        candidates.append(TRACKS_DIR / f"{track_id}.mp3")
    if source in ("auto", "previews"):
        candidates.append(PREVIEWS_DIR / f"{track_id}.mp3")

    file_path = next((p for p in candidates if p.exists()), None)
    if file_path is None:
        raise HTTPException(status_code=404, detail="Track cache file not found")

    return FileResponse(file_path, media_type="audio/mpeg", filename=file_path.name)


_TRACK_ID_RE = re.compile(r'^[a-zA-Z0-9]{1,32}$')
_VIDEO_ID_RE = re.compile(r'^[a-zA-Z0-9_-]{6,20}$')


@router.get("/search-candidates")
async def admin_search_candidates(
    track_id: str = Query(...),
    artist: str = Query(...),
    title: str = Query(...),
    duration_ms: int = Query(0),
    authorization: str = Header(),
):
    """Search YouTube Music and return scored candidates for manual selection."""
    await _require_admin(authorization)

    if not _TRACK_ID_RE.match(track_id):
        raise HTTPException(status_code=400, detail="Invalid track ID")
    if len(artist) > 200 or len(title) > 200:
        raise HTTPException(status_code=400, detail="Artist/title too long")

    from services.mix_generator import search_ytmusic_candidates
    import asyncio
    from concurrent.futures import ThreadPoolExecutor

    loop = asyncio.get_event_loop()
    with ThreadPoolExecutor(max_workers=1) as ex:
        candidates = await loop.run_in_executor(
            ex, search_ytmusic_candidates, artist, title, duration_ms
        )

    return {"track_id": track_id, "candidates": candidates}


class RedownloadRequest(BaseModel):
    track_id: str
    video_id: str
    artist: str = ""
    title: str = ""


@router.post("/redownload-track")
async def admin_redownload_track(body: RedownloadRequest, authorization: str = Header()):
    """Download and cache a specific YouTube video for a given track_id."""
    await _require_admin(authorization)

    if not _TRACK_ID_RE.match(body.track_id):
        raise HTTPException(status_code=400, detail="Invalid track ID")
    if not _VIDEO_ID_RE.match(body.video_id):
        raise HTTPException(status_code=400, detail="Invalid video ID")

    from services.mix_generator import redownload_track_by_video_id

    try:
        ok = await redownload_track_by_video_id(body.track_id, body.video_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception:
        raise HTTPException(status_code=500, detail="Download failed")

    if not ok:
        raise HTTPException(status_code=502, detail="Download failed — check logs")

    # Check the resulting file size
    cache_path = Path("/app/cache/tracks") / f"{body.track_id}.mp3"
    size_mb = round(cache_path.stat().st_size / (1024 * 1024), 2) if cache_path.exists() else 0

    return {
        "track_id": body.track_id,
        "video_id": body.video_id,
        "size_mb": size_mb,
        "success": True,
    }
