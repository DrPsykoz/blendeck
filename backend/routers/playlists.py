from __future__ import annotations
import json
import os
import httpx
from pathlib import Path
from fastapi import APIRouter, Header, HTTPException
from fastapi.responses import StreamingResponse

from services.spotify import (
    get_user_playlists,
    get_playlist_tracks,
    get_playlist_tracks_basic,
    analyze_tracks_with_progress,
)
from services import deezer, features_cache, youtube
from models.track import PlaylistSummary, Track
import re

router = APIRouter(prefix="/api/playlists", tags=["playlists"])

_SPOTIFY_ID_RE = re.compile(r'^[a-zA-Z0-9]{1,32}$')
_ALLOWED_PREVIEW_DOMAINS = {'cdns-preview-', 'cdn-preview-', '.deezer.com', '.dzcdn.net'}


def _validate_track_id(track_id: str) -> None:
    if not _SPOTIFY_ID_RE.match(track_id):
        raise HTTPException(status_code=400, detail="Invalid track ID")


def _is_safe_preview_url(url: str) -> bool:
    """Check that a preview URL points to an allowed domain."""
    if not url or not url.startswith('https://'):
        return False
    return any(domain in url for domain in _ALLOWED_PREVIEW_DOMAINS)


def _extract_token(authorization: str | None) -> str:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing or invalid token")
    return authorization.removeprefix("Bearer ").strip()


@router.get("", response_model=list[PlaylistSummary])
async def list_playlists(authorization: str = Header()):
    token = _extract_token(authorization)
    return await get_user_playlists(token)


def _validate_playlist_id(playlist_id: str) -> None:
    if not _SPOTIFY_ID_RE.match(playlist_id):
        raise HTTPException(status_code=400, detail="Invalid playlist ID")


@router.get("/{playlist_id}/tracks", response_model=list[Track])
async def playlist_tracks(playlist_id: str, authorization: str = Header()):
    _validate_playlist_id(playlist_id)
    token = _extract_token(authorization)
    return await get_playlist_tracks(token, playlist_id)


@router.get("/{playlist_id}/analyze")
async def analyze_playlist_sse(playlist_id: str, authorization: str = Header()):
    """Stream analysis progress via Server-Sent Events.

    Events:
      - type=start: {total, cached}
      - type=progress: {current, total, track_id, name, artist, status, features}
      - type=complete: {tracks: [...]}  (full track list with features)
      - type=error: {message}
    """
    _validate_playlist_id(playlist_id)
    token = _extract_token(authorization)

    async def event_stream():
        import asyncio

        try:
            # Step 1: Fetch basic tracks
            tracks = await get_playlist_tracks_basic(token, playlist_id)
            cached_count = sum(1 for t in tracks if t.audio_features is not None)
            need_count = len(tracks) - cached_count

            # Send start event
            yield _sse(
                "start",
                {"total": len(tracks), "need_analysis": need_count, "cached": cached_count},
            )

            if need_count == 0:
                # All cached — send tracks immediately
                yield _sse(
                    "complete",
                    {"tracks": [_track_dict(t) for t in tracks]},
                )
                return

            # Step 2: Analyze with progress
            async def on_progress(current, total, track_id, name, artist, status, features):
                data = {
                    "current": current,
                    "total": total,
                    "track_id": track_id,
                    "name": name,
                    "artist": artist,
                    "status": status,
                }
                if features:
                    data["features"] = features
                # We queue SSE events via a list and yield them
                progress_events.append(_sse("progress", data))

            # Use a simple list to collect events from the callback
            progress_events: list[str] = []

            # Run analysis in background and yield events
            analysis_task = asyncio.create_task(
                analyze_tracks_with_progress(token, tracks, on_progress)
            )

            while not analysis_task.done():
                await asyncio.sleep(0.3)
                while progress_events:
                    yield progress_events.pop(0)

            # Drain remaining events
            while progress_events:
                yield progress_events.pop(0)

            # Get result
            analyzed_tracks = await analysis_task

            yield _sse(
                "complete",
                {"tracks": [_track_dict(t) for t in analyzed_tracks]},
            )

        except Exception as e:
            import logging
            logging.getLogger(__name__).exception("SSE analysis error")
            yield _sse("error", {"message": "Une erreur interne est survenue"})

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


def _sse(event_type: str, data: dict) -> str:
    """Format a Server-Sent Event."""
    return f"event: {event_type}\ndata: {json.dumps(data, default=str)}\n\n"


def _track_dict(t: Track) -> dict:
    """Convert Track to dict for JSON serialization."""
    d: dict = {
        "id": t.id,
        "name": t.name,
        "artists": t.artists,
        "album": t.album,
        "album_image_url": t.album_image_url,
        "duration_ms": t.duration_ms,
        "preview_url": t.preview_url,
        "uri": t.uri,
        "release_year": t.release_year,
        "audio_features": None,
        "camelot": None,
    }
    if t.audio_features:
        af = t.audio_features
        d["audio_features"] = {
            "tempo": af.tempo, "key": af.key, "mode": af.mode,
            "energy": af.energy, "danceability": af.danceability,
            "valence": af.valence, "loudness": af.loudness,
            "acousticness": af.acousticness,
            "instrumentalness": af.instrumentalness,
            "speechiness": af.speechiness, "liveness": af.liveness,
            "duration_ms": af.duration_ms, "time_signature": af.time_signature,
        }
    if t.camelot:
        d["camelot"] = {"number": t.camelot.number, "letter": t.camelot.letter}
    return d


@router.get("/preview/{track_id}")
async def get_preview_url(track_id: str, name: str = "", artist: str = ""):
    """Fetch preview URL on-demand for a single track via Deezer, with YouTube fallback."""
    _validate_track_id(track_id)

    # Resolve track metadata from cache if not provided
    if not (name and artist):
        meta = features_cache.get_track_meta(track_id)
        if meta:
            name, artist = meta

    # Check cache first - but verify URL is still valid
    cached = features_cache.get_preview_url(track_id)
    if cached and _is_safe_preview_url(cached):
        # Quick check if Deezer URL still works
        try:
            async with httpx.AsyncClient(follow_redirects=True, timeout=5.0) as client:
                head = await client.head(cached)
                if head.status_code == 200:
                    return {"preview_url": cached}
        except Exception:
            pass
        # URL expired, clear it
        features_cache.set_preview_url(track_id, "")

    # Search Deezer for a fresh URL
    result = await deezer.search_track(artist, name)
    if result and result.get("preview_url"):
        url = result["preview_url"]
        features_cache.set_preview_url(track_id, url)
        features_cache.save()
        return {"preview_url": url}

    # Fallback: download from YouTube, save as local file
    audio_bytes = await youtube.download_audio(artist, name)
    if audio_bytes:
        _save_local_preview(track_id, audio_bytes)
        features_cache.set_preview_url(track_id, f"local:{track_id}")
        features_cache.save()
        return {"preview_url": f"local:{track_id}"}

    return {"preview_url": None}


PREVIEW_DIR = Path(os.getenv("CACHE_DIR", "/app/cache")) / "previews"


def _save_local_preview(track_id: str, audio_bytes: bytes) -> None:
    """Save audio bytes as a local preview file."""
    PREVIEW_DIR.mkdir(parents=True, exist_ok=True)
    path = PREVIEW_DIR / f"{track_id}.mp3"
    path.write_bytes(audio_bytes)


@router.get("/preview-stream/{track_id}")
async def stream_preview(track_id: str, name: str = "", artist: str = ""):
    """Proxy-stream a preview. Re-fetches from Deezer/YouTube if expired."""
    _validate_track_id(track_id)

    # Resolve track metadata from cache if not provided
    if not (name and artist):
        meta = features_cache.get_track_meta(track_id)
        if meta:
            name, artist = meta

    url = features_cache.get_preview_url(track_id)

    # Serve local YouTube-sourced preview
    if url and url.startswith("local:"):
        local_path = PREVIEW_DIR / f"{track_id}.mp3"
        if local_path.exists():
            def _iter_file():
                with open(local_path, "rb") as f:
                    yield from iter(lambda: f.read(8192), b"")
            return StreamingResponse(
                _iter_file(),
                media_type="audio/mpeg",
                headers={"Cache-Control": "public, max-age=3600"},
            )
        # File missing, fall through to re-fetch
        url = None

    # Try streaming from Deezer URL
    if url and _is_safe_preview_url(url):
        result = await _try_stream_url(url)
        if result:
            return result
        # URL expired - try to refresh it
        fresh = await deezer.search_track(artist, name) if (artist and name) else None
        if fresh and fresh.get("preview_url") and _is_safe_preview_url(fresh["preview_url"]):
            new_url = fresh["preview_url"]
            features_cache.set_preview_url(track_id, new_url)
            features_cache.save()
            result = await _try_stream_url(new_url)
            if result:
                return result

    # Last resort: download from YouTube and serve
    if artist and name:
        audio_bytes = await youtube.download_audio(artist, name)
        if audio_bytes:
            _save_local_preview(track_id, audio_bytes)
            features_cache.set_preview_url(track_id, f"local:{track_id}")
            features_cache.save()
            return StreamingResponse(
                iter([audio_bytes]),
                media_type="audio/mpeg",
                headers={"Cache-Control": "public, max-age=3600"},
            )

    raise HTTPException(status_code=404, detail="No preview available for this track")


async def _try_stream_url(url: str) -> StreamingResponse | None:
    """Try to stream from a URL. Returns StreamingResponse or None if failed."""
    try:
        client = httpx.AsyncClient(follow_redirects=True, timeout=30.0)
        resp = await client.send(
            client.build_request("GET", url),
            stream=True,
        )
        if resp.status_code != 200:
            await resp.aclose()
            await client.aclose()
            return None

        async def audio_stream():
            try:
                async for chunk in resp.aiter_bytes(chunk_size=8192):
                    yield chunk
            finally:
                await resp.aclose()
                await client.aclose()

        return StreamingResponse(
            audio_stream(),
            media_type="audio/mpeg",
            headers={
                "Accept-Ranges": "bytes",
                "Cache-Control": "public, max-age=3600",
            },
        )
    except Exception:
        return None
