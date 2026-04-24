from __future__ import annotations
import csv
import io
import json
import re

from fastapi import APIRouter, Header, HTTPException, Query
from fastapi.responses import StreamingResponse, FileResponse
from pydantic import BaseModel

from models.track import (
    ExportNewPlaylistRequest,
    ExportReorderRequest,
    ExportFileRequest,
    PreviewTransitionsRequest,
    TransitionPreview,
    TransitionOverride,
)
from services.spotify import create_playlist, add_tracks_to_playlist, replace_playlist_tracks
from services import features_cache
from services.mix_generator import generate_mix, get_mix_path, cleanup_old_mixes, get_mix_history, generate_transition_preview
from services.transition import score_transition
import asyncio

router = APIRouter(prefix="/api/export", tags=["export"])

# Limit concurrent mix generations to prevent resource exhaustion
_mix_semaphore = asyncio.Semaphore(2)


def _extract_token(authorization: str | None) -> str:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing or invalid token")
    return authorization.removeprefix("Bearer ").strip()


@router.post("/new-playlist")
async def export_new_playlist(req: ExportNewPlaylistRequest, authorization: str = Header()):
    """Create a new Spotify playlist with the given tracks."""
    token = _extract_token(authorization)
    playlist_id = await create_playlist(token, req.name, req.description, req.public)
    await add_tracks_to_playlist(token, playlist_id, req.track_uris)
    return {"playlist_id": playlist_id, "status": "created"}


_SPOTIFY_ID_RE = re.compile(r'^[a-zA-Z0-9]{1,32}$')


@router.put("/reorder")
async def export_reorder(req: ExportReorderRequest, authorization: str = Header()):
    """Reorder an existing playlist by replacing all tracks."""
    token = _extract_token(authorization)
    if not _SPOTIFY_ID_RE.match(req.playlist_id):
        raise HTTPException(status_code=400, detail="Invalid playlist ID")
    await replace_playlist_tracks(token, req.playlist_id, req.track_uris)
    return {"status": "reordered"}


@router.post("/file")
async def export_file(req: ExportFileRequest, authorization: str = Header()):
    """Export tracks as CSV or JSON file."""
    _extract_token(authorization)
    if req.format == "json":
        data = []
        for i, track in enumerate(req.tracks):
            entry = {
                "position": i + 1,
                "track": track.name,
                "artists": ", ".join(track.artists),
                "album": track.album,
                "bpm": track.audio_features.tempo if track.audio_features else None,
                "key": f"{track.audio_features.key}" if track.audio_features else None,
                "camelot": track.camelot.code if track.camelot else None,
                "energy": track.audio_features.energy if track.audio_features else None,
                "danceability": track.audio_features.danceability if track.audio_features else None,
            }
            # Add transition score if available
            transition = next(
                (t for t in req.transitions if t.to_track_id == track.id), None
            )
            entry["transition_score"] = transition.total_score if transition else None
            data.append(entry)

        content = json.dumps(data, indent=2, ensure_ascii=False)
        return StreamingResponse(
            io.BytesIO(content.encode("utf-8")),
            media_type="application/json",
            headers={"Content-Disposition": "attachment; filename=dj-set.json"},
        )

    # CSV format
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow([
        "Position", "Track", "Artists", "Album", "BPM", "Key", "Camelot",
        "Energy", "Danceability", "Transition Score",
    ])

    for i, track in enumerate(req.tracks):
        transition = next(
            (t for t in req.transitions if t.to_track_id == track.id), None
        )
        writer.writerow([
            i + 1,
            track.name,
            ", ".join(track.artists),
            track.album,
            track.audio_features.tempo if track.audio_features else "",
            track.audio_features.key if track.audio_features else "",
            track.camelot.code if track.camelot else "",
            track.audio_features.energy if track.audio_features else "",
            track.audio_features.danceability if track.audio_features else "",
            transition.total_score if transition else "",
        ])

    csv_bytes = output.getvalue().encode("utf-8")
    return StreamingResponse(
        io.BytesIO(csv_bytes),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=dj-set.csv"},
    )


class MixTrack(BaseModel):
    id: str
    name: str
    artist: str
    duration_ms: int = 0


class TransitionConfig(BaseModel):
    style: str = "multiband"  # crossfade, fade, cut, echo, beatmatch, superpose, multiband
    duration: int = 8


class MixRequest(BaseModel):
    tracks: list[MixTrack]
    crossfade: int = 8  # seconds
    target_duration: int = 0  # seconds per track, 0 = no trimming
    transition_style: str = "multiband"  # global default style
    transitions: list[TransitionConfig] | None = None  # per-pair overrides
    playlist_id: str = ""


def _mix_sse(event_type: str, data: dict) -> str:
    return f"event: {event_type}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


@router.post("/mix")
async def export_mix(req: MixRequest, authorization: str = Header()):
    """Generate a DJ mix MP3 by downloading tracks from YouTube and concatenating with crossfade.

    Returns SSE stream with progress events, ending with a mix_id for download.
    """
    _extract_token(authorization)
    cleanup_old_mixes()

    # Enrich track dicts with BPM from features cache for beat-aware crossfade duration
    def _get_track_bpm(track_id: str) -> float:
        features = features_cache.get_audio_features(track_id)
        if features:
            return float(features.get("tempo", 0) or features.get("bpm", 0) or 0)
        return 0.0

    track_dicts = [
        {
            "id": t.id, "name": t.name, "artist": t.artist,
            "duration_ms": t.duration_ms,
            "bpm": _get_track_bpm(t.id),
        }
        for t in req.tracks
    ]
    crossfade_s = max(0, min(req.crossfade, 15))
    target_dur = max(0, min(req.target_duration, 600))  # cap at 10 min
    allowed_styles = {"crossfade", "fade", "cut", "echo", "beatmatch", "superpose", "multiband", "auto"}
    trans_style = req.transition_style if req.transition_style in allowed_styles else "multiband"
    trans_overrides = None
    if req.transitions:
        trans_overrides = [
            {"style": t.style if t.style in allowed_styles else "multiband", "duration": max(0, min(t.duration, 15))}
            for t in req.transitions
        ]

    async def event_stream():
        progress_events: list[str] = []

        try:
            await asyncio.wait_for(_mix_semaphore.acquire(), timeout=0.1)
        except asyncio.TimeoutError:
            yield _mix_sse("error", {"message": "Trop de mix en cours, réessayez dans quelques minutes"})
            return

        try:
            async def on_progress(status: str, current: int, total: int, detail: str):
                progress_events.append(_mix_sse("progress", {
                    "status": status,
                    "current": current,
                    "total": total,
                    "detail": detail,
                }))

            task = asyncio.create_task(generate_mix(
                track_dicts, crossfade_s, on_progress, target_dur,
                transition_style=trans_style, transitions_override=trans_overrides,
                playlist_id=req.playlist_id,
            ))

            yield _mix_sse("start", {"total": len(track_dicts), "crossfade": crossfade_s})

            while not task.done():
                await asyncio.sleep(0.5)
                while progress_events:
                    yield progress_events.pop(0)

            # Drain remaining
            while progress_events:
                yield progress_events.pop(0)

            mix_id = await task

            if mix_id:
                yield _mix_sse("complete", {"mix_id": mix_id})
            else:
                yield _mix_sse("error", {"message": "Échec de la génération du mix"})
        finally:
            _mix_semaphore.release()

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


_MIX_ID_RE = re.compile(r'^[a-zA-Z0-9]{1,20}$')


@router.get("/mix/{mix_id}")
async def download_mix(mix_id: str, authorization: str = Header()):
    """Download a generated mix MP3."""
    _extract_token(authorization)
    if not _MIX_ID_RE.match(mix_id):
        raise HTTPException(status_code=400, detail="Invalid mix ID")

    path = get_mix_path(mix_id)
    if not path:
        raise HTTPException(status_code=404, detail="Mix not found or expired")

    return FileResponse(
        path,
        media_type="audio/mpeg",
        filename=f"dj-mix-{mix_id}.mp3",
        headers={"Content-Disposition": f"attachment; filename=dj-mix-{mix_id}.mp3"},
    )


@router.get("/mix/{mix_id}/stream")
async def stream_mix(mix_id: str, authorization: str = Header()):
    """Stream a generated mix MP3 for in-app playback."""
    _extract_token(authorization)
    if not _MIX_ID_RE.match(mix_id):
        raise HTTPException(status_code=400, detail="Invalid mix ID")

    path = get_mix_path(mix_id)
    if not path:
        raise HTTPException(status_code=404, detail="Mix not found or expired")

    return FileResponse(
        path,
        media_type="audio/mpeg",
        headers={
            "Accept-Ranges": "bytes",
            "Content-Disposition": "inline",
        },
    )


@router.get("/mix-history")
async def mix_history(playlist_id: str = Query(""), authorization: str = Header()):
    """Return the last 5 generated mixes metadata for a playlist."""
    _extract_token(authorization)
    return get_mix_history(playlist_id)


_TRACK_ID_RE = re.compile(r'^[a-zA-Z0-9]{1,32}$')
_ALLOWED_STYLES = {"crossfade", "fade", "cut", "echo", "beatmatch", "superpose", "multiband", "auto"}


def _resolve_transition_style(style: str, transition_score) -> str:
    if style != "auto":
        return style
    if transition_score.bpm_score >= 0.9 and transition_score.energy_score >= 0.65:
        return "beatmatch"
    if transition_score.energy_score <= 0.4:
        return "fade"
    if transition_score.key_score <= 0.35:
        return "echo"
    return "multiband"


@router.post("/transitions", response_model=list[TransitionPreview])
async def preview_transitions(req: PreviewTransitionsRequest, authorization: str = Header()):
    """Compute adjacent transition scores for the provided track order."""
    _extract_token(authorization)

    style = req.transition_style if req.transition_style in _ALLOWED_STYLES else "multiband"
    duration = max(1, min(req.transition_duration, 15))
    tracks = req.tracks
    override_map: dict[tuple[str, str], TransitionOverride] = {
        (transition.from_track_id, transition.to_track_id): transition
        for transition in req.transitions
        if _TRACK_ID_RE.match(transition.from_track_id) and _TRACK_ID_RE.match(transition.to_track_id)
    }

    if len(tracks) < 2:
        return []

    previews: list[TransitionPreview] = []
    total_pairs = len(tracks) - 1
    for idx in range(total_pairs):
        position_ratio = idx / max(total_pairs - 1, 1)
        transition = score_transition(
            tracks[idx],
            tracks[idx + 1],
            position_ratio=position_ratio,
            energy_curve=req.energy_curve,
        )
        pair_key = (tracks[idx].id, tracks[idx + 1].id)
        override = override_map.get(pair_key)
        resolved_style_input = override.style if override else style
        resolved_duration = max(1, min(override.duration or duration, 15)) if override else duration
        previews.append(
            TransitionPreview(
                **transition.model_dump(),
                style=_resolve_transition_style(resolved_style_input, transition),
                duration=resolved_duration,
            )
        )

    return previews


@router.get("/transition-preview")
async def transition_preview(
    from_id: str = Query(...),
    to_id: str = Query(...),
    from_name: str = Query(""),
    from_artist: str = Query(""),
    to_name: str = Query(""),
    to_artist: str = Query(""),
    style: str = Query("multiband"),
    duration: int = Query(8),
    target_duration: int = Query(0),
    from_is_first: bool = Query(False),
    authorization: str = Header(),
):
    """Generate and stream a short crossfade preview between two tracks."""
    _extract_token(authorization)

    if not _TRACK_ID_RE.match(from_id) or not _TRACK_ID_RE.match(to_id):
        raise HTTPException(status_code=400, detail="Invalid track ID")

    style = style if style in _ALLOWED_STYLES else "multiband"
    if style == "auto":
        style = "multiband"
    duration = max(1, min(duration, 15))
    target_duration = max(0, min(target_duration, 600))

    try:
        await asyncio.wait_for(_mix_semaphore.acquire(), timeout=0.1)
    except asyncio.TimeoutError:
        raise HTTPException(status_code=503, detail="Trop de générations en cours, réessayez")

    try:
        path = await generate_transition_preview(
            from_id, to_id,
            from_artist, from_name,
            to_artist, to_name,
            style, duration, target_duration, from_is_first,
        )
    finally:
        _mix_semaphore.release()

    if not path:
        raise HTTPException(status_code=500, detail="Échec de la génération de la preview")

    return FileResponse(
        path,
        media_type="audio/mpeg",
        headers={
            "Accept-Ranges": "bytes",
            "Content-Disposition": "inline",
        },
    )
