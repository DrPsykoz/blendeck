from __future__ import annotations
import re
from fastapi import APIRouter, Header, HTTPException

from models.track import (
    GenerateSetRequest,
    GeneratedSet,
    Track,
)
from services.set_generator import generate_set
from services.spotify import get_playlist_tracks

router = APIRouter(prefix="/api", tags=["sort"])

_SPOTIFY_ID_RE = re.compile(r'^[a-zA-Z0-9]{1,32}$')


def _extract_token(authorization: str | None) -> str:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing or invalid token")
    return authorization.removeprefix("Bearer ").strip()


@router.post("/sort-playlist/{playlist_id}", response_model=list[Track])
async def sort_playlist(
    playlist_id: str, sort_by: str = "bpm", ascending: bool = True, authorization: str = Header()
):
    """Fetch playlist tracks and sort by a criterion."""
    if not _SPOTIFY_ID_RE.match(playlist_id):
        raise HTTPException(status_code=400, detail="Invalid playlist ID")
    token = _extract_token(authorization)
    tracks = await get_playlist_tracks(token, playlist_id)

    key_map = {
        "bpm": lambda t: t.audio_features.tempo if t.audio_features else 0,
        "energy": lambda t: t.audio_features.energy if t.audio_features else 0,
        "danceability": lambda t: t.audio_features.danceability if t.audio_features else 0,
        "valence": lambda t: t.audio_features.valence if t.audio_features else 0,
        "key": lambda t: (
            (t.camelot.number, t.camelot.letter) if t.camelot else (99, "Z")
        ),
        "loudness": lambda t: t.audio_features.loudness if t.audio_features else -60,
        "year": lambda t: t.release_year if t.release_year else 0,
    }

    sort_fn = key_map.get(sort_by)
    if sort_fn is None:
        raise HTTPException(status_code=400, detail=f"Unknown sort_by: {sort_by}")

    tracks.sort(key=sort_fn, reverse=not ascending)
    return tracks


@router.post("/generate-set/{playlist_id}", response_model=GeneratedSet)
async def generate_dj_set(
    playlist_id: str, req: GenerateSetRequest | None = None, authorization: str = Header()
):
    """Generate an optimized DJ set from a playlist."""
    if not _SPOTIFY_ID_RE.match(playlist_id):
        raise HTTPException(status_code=400, detail="Invalid playlist ID")
    token = _extract_token(authorization)
    tracks = await get_playlist_tracks(token, playlist_id)

    if not tracks:
        raise HTTPException(status_code=404, detail="No tracks found")

    params = req or GenerateSetRequest(track_ids=[])

    result = generate_set(
        tracks=tracks,
        energy_curve=params.energy_curve,
        bpm_weight=params.bpm_weight,
        key_weight=params.key_weight,
        energy_weight=params.energy_weight,
        danceability_weight=params.danceability_weight,
        year_weight=params.year_weight,
        beam_width=params.beam_width,
    )
    return result
