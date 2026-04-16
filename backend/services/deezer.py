from __future__ import annotations
import logging
import httpx

logger = logging.getLogger(__name__)

DEEZER_API = "https://api.deezer.com"


async def search_track(artist: str, title: str) -> dict | None:
    """Search Deezer for a track and return its info (bpm, preview url, etc.).

    Returns dict with keys: bpm, preview_url, deezer_id  or None if not found.
    """
    query = f'artist:"{artist}" track:"{title}"'
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.get(
                f"{DEEZER_API}/search",
                params={"q": query, "limit": 1},
            )
            if resp.status_code != 200:
                logger.warning(f"Deezer search failed: HTTP {resp.status_code}")
                return None

            data = resp.json()
            items = data.get("data", [])
            if not items:
                # Try simpler search without field specifiers
                resp = await client.get(
                    f"{DEEZER_API}/search",
                    params={"q": f"{artist} {title}", "limit": 1},
                )
                if resp.status_code != 200:
                    return None
                data = resp.json()
                items = data.get("data", [])
                if not items:
                    return None

            track = items[0]
            track_id = track.get("id")
            preview_url = track.get("preview")

            # Fetch full track details for BPM
            bpm = 0
            if track_id:
                detail_resp = await client.get(f"{DEEZER_API}/track/{track_id}")
                if detail_resp.status_code == 200:
                    detail = detail_resp.json()
                    bpm = detail.get("bpm", 0) or 0

            return {
                "bpm": bpm,
                "preview_url": preview_url,
                "deezer_id": track_id,
            }

    except Exception as e:
        logger.error(f"Deezer search error for '{artist} - {title}': {e}")
        return None


async def download_preview(url: str) -> bytes | None:
    """Download a 30s Deezer preview MP3."""
    if not url:
        return None
    try:
        async with httpx.AsyncClient(timeout=30.0, follow_redirects=True) as client:
            resp = await client.get(url)
            if resp.status_code == 200:
                return resp.content
            logger.warning(f"Deezer preview download failed: HTTP {resp.status_code}")
            return None
    except Exception as e:
        logger.error(f"Deezer preview download error: {e}")
        return None
