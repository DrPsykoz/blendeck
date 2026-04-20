from __future__ import annotations
import asyncio
import json
import logging
import os
import re
import shutil
import subprocess
import tempfile
import time
import uuid
import unicodedata
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Callable, Awaitable

import numpy as np
import yt_dlp
from ytmusicapi import YTMusic

logger = logging.getLogger(__name__)
_executor = ThreadPoolExecutor(max_workers=6)
_ytmusic = YTMusic()


def _int_env(name: str, default: int, min_value: int = 1, max_value: int = 8) -> int:
    """Read and clamp an integer env var, with safe fallback."""
    raw = os.getenv(name)
    if raw is None:
        return default
    try:
        value = int(raw)
    except ValueError:
        logger.warning(f"Mix: invalid value for {name}='{raw}', using {default}")
        return default
    return max(min_value, min(max_value, value))


_MIX_DOWNLOAD_CONCURRENCY = _int_env("MIX_DOWNLOAD_CONCURRENCY", 3)
_MIX_TRIM_CONCURRENCY = _int_env("MIX_TRIM_CONCURRENCY", 2)
_MIX_ANALYSIS_CONCURRENCY = _int_env("MIX_ANALYSIS_CONCURRENCY", 2)
_MIX_CONCAT_BATCH_SIZE = _int_env("MIX_CONCAT_BATCH_SIZE", 2, min_value=2, max_value=10)
_MIX_PREFETCH_CONCURRENCY = _int_env("MIX_PREFETCH_CONCURRENCY", 2, min_value=1, max_value=6)
_MIX_PREFETCH_MAX_TRACKS = _int_env("MIX_PREFETCH_MAX_TRACKS", 80, min_value=1, max_value=500)

MIX_DIR = Path("/app/cache/mixes")
MIX_DIR.mkdir(parents=True, exist_ok=True)

TRACK_CACHE_DIR = Path("/app/cache/tracks")
TRACK_CACHE_DIR.mkdir(parents=True, exist_ok=True)


def get_cached_track_ids(track_ids: list[str]) -> set[str]:
    """Return the subset of track_ids whose full MP3 exists in cache."""
    return {tid for tid in track_ids if (TRACK_CACHE_DIR / f"{tid}.mp3").exists()}

TRIM_CACHE_DIR = Path("/app/cache/trimmed")
TRIM_CACHE_DIR.mkdir(parents=True, exist_ok=True)

# Keep generated mixes for 1 hour max
_mix_files: dict[str, Path] = {}

# Mix history: list of metadata dicts, newest first, max 5
_MIX_HISTORY_FILE = MIX_DIR / "history.json"
_mix_history: dict[str, list[dict]] = {}  # playlist_id -> list of entries

MAX_HISTORY_PER_PLAYLIST = 5


def _load_history() -> None:
    global _mix_history
    if _MIX_HISTORY_FILE.exists():
        try:
            data = json.loads(_MIX_HISTORY_FILE.read_text())
            # Migration: if old format is a list, discard it
            if isinstance(data, dict):
                _mix_history = data
            else:
                _mix_history = {}
        except Exception:
            _mix_history = {}


def _save_history() -> None:
    try:
        _MIX_HISTORY_FILE.write_text(json.dumps(_mix_history, ensure_ascii=False))
    except Exception as e:
        logger.error(f"History: failed to save: {e}")


def _add_to_history(playlist_id: str, mix_id: str, track_count: int, track_names: list[str],
                    transition_style: str, crossfade_s: int, size_mb: float) -> None:
    entry = {
        "mix_id": mix_id,
        "created_at": time.time(),
        "track_count": track_count,
        "track_names": track_names[:20],
        "transition_style": transition_style,
        "crossfade_s": crossfade_s,
        "size_mb": round(size_mb, 1),
    }
    playlist_history = _mix_history.setdefault(playlist_id, [])
    playlist_history.insert(0, entry)
    while len(playlist_history) > MAX_HISTORY_PER_PLAYLIST:
        removed = playlist_history.pop()
        old_path = MIX_DIR / f"{removed['mix_id']}.mp3"
        old_path.unlink(missing_ok=True)
        _mix_files.pop(removed["mix_id"], None)
    _save_history()


def get_mix_history(playlist_id: str) -> list[dict]:
    """Return list of recent mixes for a playlist (newest first), pruning missing files."""
    entries = _mix_history.get(playlist_id, [])
    valid = [e for e in entries if (MIX_DIR / f"{e['mix_id']}.mp3").exists()]
    _mix_history[playlist_id] = valid
    _save_history()
    return list(valid)


def _all_history_mix_ids() -> set[str]:
    """Return all mix_ids across all playlists in history."""
    ids: set[str] = set()
    for entries in _mix_history.values():
        for e in entries:
            ids.add(e["mix_id"])
    return ids


_load_history()


def _get_cached_track(track_id: str) -> Path | None:
    """Return path to cached track MP3, or None."""
    cached = TRACK_CACHE_DIR / f"{track_id}.mp3"
    if cached.exists() and cached.stat().st_size > 1000:
        return cached
    return None


def _safe_track_id(track_id: str) -> str:
    safe = re.sub(r"[^a-zA-Z0-9_-]", "", track_id or "")
    return safe[:64] if safe else "unknown"


def _trim_cache_path(track_id: str, target_s: int, source_size: int) -> Path:
    safe_id = _safe_track_id(track_id)
    return TRIM_CACHE_DIR / f"{safe_id}_t{target_s}_s{source_size}.mp3"


def _get_cached_trimmed_track(track_id: str, target_s: int, source_size: int) -> Path | None:
    cached = _trim_cache_path(track_id, target_s, source_size)
    if cached.exists() and cached.stat().st_size > 1000:
        return cached
    return None


def _store_trimmed_track_cache(track_id: str, target_s: int, source_size: int, src_path: Path) -> None:
    """Store a trimmed output in cache, keyed by track+params+source size."""
    try:
        cache_path = _trim_cache_path(track_id, target_s, source_size)
        tmp_path = cache_path.with_suffix(".tmp")
        shutil.copy(str(src_path), str(tmp_path))
        tmp_path.replace(cache_path)
    except Exception as e:
        logger.warning(f"Trim cache: failed to store '{track_id}' target={target_s}s: {e}")


def _normalize_text(text: str) -> str:
    """Lowercase + remove accents/punctuation for robust text matching."""
    normalized = unicodedata.normalize("NFKD", text or "")
    ascii_text = normalized.encode("ascii", "ignore").decode("ascii")
    ascii_text = ascii_text.lower()
    return re.sub(r"[^a-z0-9]+", " ", ascii_text).strip()


def _tokenize(text: str) -> set[str]:
    stop = {
        "the", "and", "feat", "ft", "official", "audio", "video", "music", "song", "original",
        "de", "la", "le", "les", "des", "du", "et", "avec", "version",
    }
    tokens = {t for t in _normalize_text(text).split() if len(t) > 1}
    return {t for t in tokens if t not in stop}


def _has_unwanted_marker(text: str) -> bool:
    txt = _normalize_text(text)
    bad_markers = (
        "cover", "karaoke", "tribute", "live", "remix", "reprise", "sped up", "nightcore", "8d",
        "instrumental", "fanmade", "fan made",
    )
    return any(marker in txt for marker in bad_markers)


def _score_ytmusic_result(result: dict, artist: str, title: str, duration_ms: int = 0) -> float:
    """Score YTMusic results to prefer original studio versions over covers/reprises."""
    result_title = result.get("title") or ""
    result_artists = " ".join((a.get("name") or "") for a in (result.get("artists") or []) if isinstance(a, dict))

    score = 0.0
    title_norm = _normalize_text(title)
    artist_norm = _normalize_text(artist)
    result_title_norm = _normalize_text(result_title)
    result_artist_norm = _normalize_text(result_artists)

    # Penalize likely non-original versions.
    if _has_unwanted_marker(result_title):
        score -= 25.0

    # Strong artist matching.
    if artist_norm and result_artist_norm:
        if artist_norm in result_artist_norm:
            score += 12.0
        artist_overlap = len(_tokenize(artist) & _tokenize(result_artists))
        score += min(artist_overlap * 3.0, 9.0)

    # Strong title matching.
    if title_norm and result_title_norm:
        if title_norm in result_title_norm or result_title_norm in title_norm:
            score += 12.0
        title_overlap = len(_tokenize(title) & _tokenize(result_title))
        score += min(title_overlap * 2.0, 10.0)

    # Duration matching with strict penalties for large differences.
    if duration_ms > 0:
        target_s = duration_ms / 1000
        dur_s = float(result.get("duration_seconds") or 0)
        if dur_s > 0:
            diff = abs(dur_s - target_s)
            if diff <= 5:
                score += 10.0
            elif diff <= 15:
                score += 6.0
            elif diff <= 30:
                score += 2.0
            elif diff <= 60:
                score -= 4.0
            else:
                score -= 12.0

    # Mild bonus for explicit official label (without making it mandatory).
    if "official" in result_title_norm and "audio" in result_title_norm:
        score += 2.0

    return score


def _search_ytmusic(artist: str, title: str, duration_ms: int = 0) -> str | None:
    """Search YouTube Music for the best matching video ID."""
    try:
        results = _ytmusic.search(f"{artist} {title}", filter="songs", limit=12)
        if not results:
            results = _ytmusic.search(f"{artist} {title}", filter="videos", limit=12)
        if not results:
            return None

        scored: list[tuple[float, dict]] = []
        for r in results:
            vid_id = r.get("videoId")
            if not vid_id:
                continue
            score = _score_ytmusic_result(r, artist, title, duration_ms)
            scored.append((score, r))

        if not scored:
            return None

        scored.sort(key=lambda x: x[0], reverse=True)
        best_score, best_result = scored[0]
        best_vid = best_result.get("videoId")
        best_title = best_result.get("title") or ""
        best_artists = ", ".join(
            (a.get("name") or "") for a in (best_result.get("artists") or []) if isinstance(a, dict)
        )

        # If all candidates are poor, avoid forcing a likely bad pick.
        if best_score < 2.0:
            logger.warning(
                f"YTMusic: no confident match for '{artist} - {title}' (best_score={best_score:.1f}), fallback search"
            )
            return None

        logger.info(
            f"YTMusic: matched '{artist} - {title}' → {best_vid} score={best_score:.1f} "
            f"candidate='{best_artists} - {best_title}'"
        )
        return best_vid
    except Exception as e:
        logger.warning(f"YTMusic search failed for '{artist} - {title}': {e}")
    return None


def search_ytmusic_candidates(artist: str, title: str, duration_ms: int = 0) -> list[dict]:
    """Return scored YouTube Music candidates for manual selection.

    Returns up to 10 results (songs then videos), each as:
    {
        "video_id": str,
        "title": str,
        "artists": str,
        "duration_seconds": int,
        "score": float,
        "thumbnail_url": str | None,
    }
    """
    try:
        songs = _ytmusic.search(f"{artist} {title}", filter="songs", limit=8) or []
        videos = _ytmusic.search(f"{artist} {title}", filter="videos", limit=6) or []
        all_results = songs + videos
    except Exception as e:
        logger.warning(f"YTMusic candidate search failed for '{artist} - {title}': {e}")
        return []

    seen: set[str] = set()
    candidates: list[dict] = []
    for r in all_results:
        vid_id = r.get("videoId")
        if not vid_id or vid_id in seen:
            continue
        seen.add(vid_id)
        score = _score_ytmusic_result(r, artist, title, duration_ms)
        result_title = r.get("title") or ""
        result_artists = ", ".join(
            (a.get("name") or "") for a in (r.get("artists") or []) if isinstance(a, dict)
        )
        # Thumbnail: try thumbnails list
        thumbnails = r.get("thumbnails") or []
        thumbnail_url: str | None = thumbnails[-1].get("url") if thumbnails else None

        candidates.append({
            "video_id": vid_id,
            "title": result_title,
            "artists": result_artists,
            "duration_seconds": int(r.get("duration_seconds") or 0),
            "score": round(score, 1),
            "thumbnail_url": thumbnail_url,
        })

    candidates.sort(key=lambda x: x["score"], reverse=True)
    return candidates[:10]


async def redownload_track_by_video_id(track_id: str, video_id: str) -> bool:
    """Download and cache a specific YouTube video for the given track_id.
    
    Replaces any existing cached track.
    """
    import re as _re
    if not _re.match(r'^[a-zA-Z0-9_-]{6,20}$', video_id):
        raise ValueError(f"Invalid video_id: {video_id}")

    cache_path = TRACK_CACHE_DIR / f"{_safe_track_id(track_id)}.mp3"
    loop = asyncio.get_event_loop()
    tmp_path = Path(tempfile.mkdtemp()) / "track.mp3"

    ok = await loop.run_in_executor(_executor, _download_by_video_id, video_id, tmp_path)
    if not ok or not tmp_path.exists():
        return False

    TRACK_CACHE_DIR.mkdir(parents=True, exist_ok=True)
    shutil.move(str(tmp_path), str(cache_path))
    logger.info(f"redownload_track_by_video_id: saved {cache_path} ({cache_path.stat().st_size // 1024}KB)")
    return True


def _download_by_video_id(video_id: str, out_path: Path) -> bool:
    """Download a specific YouTube video by ID."""
    tmp_dir = tempfile.mkdtemp()
    url = f"https://music.youtube.com/watch?v={video_id}"

    ydl_opts = {
        "format": "bestaudio/best",
        "noplaylist": True,
        "quiet": True,
        "no_warnings": True,
        "outtmpl": str(Path(tmp_dir) / "track.%(ext)s"),
        "postprocessors": [
            {
                "key": "FFmpegExtractAudio",
                "preferredcodec": "mp3",
                "preferredquality": "192",
            }
        ],
        "socket_timeout": 30,
        "retries": 3,
    }

    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            ydl.download([url])
    except Exception as e:
        logger.error(f"Mix: yt-dlp download failed for {video_id}: {e}")
        shutil.rmtree(tmp_dir, ignore_errors=True)
        return False

    mp3_files = list(Path(tmp_dir).glob("*.mp3"))
    if not mp3_files:
        shutil.rmtree(tmp_dir, ignore_errors=True)
        return False

    shutil.move(str(mp3_files[0]), str(out_path))
    shutil.rmtree(tmp_dir, ignore_errors=True)
    return True


def _hardlink_or_copy(src: Path, dst: Path) -> None:
    """Try to hardlink, fall back to copy."""
    try:
        dst.hardlink_to(src)
    except OSError:
        shutil.copy(str(src), str(dst))


def _download_full_track(track_id: str, artist: str, title: str, out_path: Path, duration_ms: int = 0) -> bool:
    """Download full track: YT Music search → fallback generic YouTube search."""
    # Check cache first
    cached = _get_cached_track(track_id)
    if cached:
        _hardlink_or_copy(cached, out_path)
        logger.info(f"Mix: cache hit for '{artist} - {title}' ({cached.stat().st_size // 1024}KB)")
        return True

    # Strategy 1: YouTube Music precise search
    video_id = _search_ytmusic(artist, title, duration_ms)
    if video_id:
        if _download_by_video_id(video_id, out_path):
            # Save to cache
            cache_path = TRACK_CACHE_DIR / f"{track_id}.mp3"
            shutil.copy(str(out_path), str(cache_path))
            logger.info(f"Mix: YTMusic download OK for '{artist} - {title}' ({out_path.stat().st_size // 1024}KB)")
            return True

    # Strategy 2: Fallback to generic YouTube search
    queries = [
        f"{artist} {title} official audio -cover -karaoke -live -tribute -remix -reprise",
        f"{artist} {title} topic -cover -karaoke -live -tribute -remix -reprise",
        f"{artist} {title} audio -cover -karaoke -live -tribute -remix -reprise",
    ]

    for attempt, query in enumerate(queries):
        tmp_dir = tempfile.mkdtemp()

        ydl_opts = {
            "format": "bestaudio/best",
            "default_search": "ytsearch1",
            "noplaylist": True,
            "quiet": True,
            "no_warnings": True,
            "outtmpl": str(Path(tmp_dir) / "track.%(ext)s"),
            "postprocessors": [
                {
                    "key": "FFmpegExtractAudio",
                    "preferredcodec": "mp3",
                    "preferredquality": "192",
                }
            ],
            "socket_timeout": 30,
            "retries": 3,
        }

        try:
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                info = ydl.extract_info(query, download=True)
                if info is None:
                    shutil.rmtree(tmp_dir, ignore_errors=True)
                    continue
        except Exception as e:
            logger.error(f"Mix: YT fallback error for '{query}': {e}")
            shutil.rmtree(tmp_dir, ignore_errors=True)
            continue

        mp3_files = list(Path(tmp_dir).glob("*.mp3"))
        if not mp3_files:
            shutil.rmtree(tmp_dir, ignore_errors=True)
            continue

        cache_path = TRACK_CACHE_DIR / f"{track_id}.mp3"
        shutil.copy(str(mp3_files[0]), str(cache_path))
        shutil.move(str(mp3_files[0]), str(out_path))
        shutil.rmtree(tmp_dir, ignore_errors=True)
        logger.info(f"Mix: YT fallback OK for '{artist} - {title}' ({out_path.stat().st_size // 1024}KB)")
        return True

    logger.error(f"Mix: FAILED all attempts for '{artist} - {title}'")
    return False


def _prefetch_one_track(track_id: str, artist: str, title: str, duration_ms: int = 0) -> tuple[bool, bool]:
    """Prefetch one full track into cache.

    Returns (ok, was_cached_before).
    """
    if _get_cached_track(track_id):
        return True, True

    fd, tmp_name = tempfile.mkstemp(prefix="prefetch_", suffix=".mp3", dir=str(MIX_DIR))
    os.close(fd)
    tmp_path = Path(tmp_name)
    try:
        ok = _download_full_track(track_id, artist, title, tmp_path, duration_ms)
        return ok, False
    finally:
        tmp_path.unlink(missing_ok=True)


async def prefetch_tracks_audio_cache(tracks: list[dict], playlist_id: str = "") -> dict:
    """Warm up full-track audio cache in background for future mix generation.

    This function is intentionally non-blocking for API callers: it is expected
    to be launched via asyncio.create_task from routers.
    """
    if not tracks:
        return {"playlist_id": playlist_id, "queued": 0, "downloaded": 0, "cached": 0, "failed": 0}

    picked = tracks[:_MIX_PREFETCH_MAX_TRACKS]
    loop = asyncio.get_event_loop()
    sem = asyncio.Semaphore(_MIX_PREFETCH_CONCURRENCY)

    downloaded = 0
    cached = 0
    failed = 0

    async def _run_one(t: dict) -> None:
        nonlocal downloaded, cached, failed
        track_id = str(t.get("id") or "").strip()
        if not track_id:
            failed += 1
            return

        artist = str(t.get("artist") or "").strip()
        title = str(t.get("name") or "").strip()
        duration_ms = int(t.get("duration_ms") or 0)

        async with sem:
            ok, was_cached = await loop.run_in_executor(
                _executor,
                _prefetch_one_track,
                track_id,
                artist,
                title,
                duration_ms,
            )

        if ok and was_cached:
            cached += 1
        elif ok:
            downloaded += 1
        else:
            failed += 1

    await asyncio.gather(*[_run_one(t) for t in picked])

    logger.info(
        "Prefetch: playlist=%s queued=%d downloaded=%d cached=%d failed=%d",
        playlist_id or "-",
        len(picked),
        downloaded,
        cached,
        failed,
    )

    return {
        "playlist_id": playlist_id,
        "queued": len(picked),
        "downloaded": downloaded,
        "cached": cached,
        "failed": failed,
    }


def _analyze_energy_curve(mp3_path: Path) -> list[float]:
    """Analyze an MP3 and return per-second RMS energy values (fast, low-SR)."""
    import librosa

    try:
        y, sr = librosa.load(str(mp3_path), sr=11025, mono=True)
    except Exception as e:
        logger.error(f"Trim: failed to load '{mp3_path.name}': {e}")
        return []

    hop = sr  # 1 second
    rms = librosa.feature.rms(y=y, frame_length=sr, hop_length=hop)[0]
    return rms.tolist()


def _analyze_vocal_presence(mp3_path: Path) -> list[float]:
    """Estimate per-second vocal likelihood (fast, low-SR)."""
    import librosa

    try:
        y, sr = librosa.load(str(mp3_path), sr=11025, mono=True)
    except Exception as e:
        logger.error(f"Vocal: failed to load '{mp3_path.name}': {e}")
        return []

    S = librosa.feature.melspectrogram(y=y, sr=sr, n_mels=64, hop_length=512)
    mel_freqs = librosa.mel_frequencies(n_mels=64, fmin=0.0, fmax=float(sr) / 2)
    vocal_low = int(np.searchsorted(mel_freqs, 300))
    vocal_high = int(np.searchsorted(mel_freqs, 3500))
    total = np.sum(S, axis=0) + 1e-10
    vocal = np.sum(S[vocal_low:vocal_high], axis=0)
    vocal_ratio = vocal / total

    fps = sr // 512
    n_seconds = len(vocal_ratio) // fps
    per_second = []
    for i in range(n_seconds):
        chunk = vocal_ratio[i * fps : (i + 1) * fps]
        per_second.append(float(np.mean(chunk)))

    return per_second


def _analyze_for_trim(mp3_path: Path) -> tuple[list[float], list[float]]:
    """Single-load analysis: returns (energy_curve, vocal_score) together.

    Loads audio once at low sample rate for both energy and vocal analysis,
    cutting total analysis time roughly in half vs separate calls.
    """
    import librosa

    try:
        y, sr = librosa.load(str(mp3_path), sr=11025, mono=True)
    except Exception as e:
        logger.error(f"Trim: failed to load '{mp3_path.name}': {e}")
        return [], []

    # Energy: per-second RMS
    rms = librosa.feature.rms(y=y, frame_length=sr, hop_length=sr)[0]
    energy = rms.tolist()

    # Vocal presence: mel spectrogram ratio in vocal band
    S = librosa.feature.melspectrogram(y=y, sr=sr, n_mels=64, hop_length=512)
    mel_freqs = librosa.mel_frequencies(n_mels=64, fmin=0.0, fmax=float(sr) / 2)
    vocal_low = int(np.searchsorted(mel_freqs, 300))
    vocal_high = int(np.searchsorted(mel_freqs, 3500))
    total = np.sum(S, axis=0) + 1e-10
    vocal = np.sum(S[vocal_low:vocal_high], axis=0)
    vocal_ratio = vocal / total

    fps = sr // 512
    n_seconds = len(vocal_ratio) // fps
    vocal_score = []
    for i in range(n_seconds):
        chunk = vocal_ratio[i * fps : (i + 1) * fps]
        vocal_score.append(float(np.mean(chunk)))

    return energy, vocal_score


def _analyze_transition_points(mp3_path: Path) -> dict:
    """Analyze a track to find optimal transition in/out points.

    Returns {"duration_s", "intro_end_s", "outro_start_s", "bpm", "energy_curve"}.
    - intro_end_s: when the track reaches full energy (good entry point ends)
    - outro_start_s: when energy starts dropping (good exit point starts)
    """
    import librosa

    try:
        y, sr = librosa.load(str(mp3_path), sr=11025, mono=True)
    except Exception as e:
        logger.error(f"Transition: failed to load '{mp3_path.name}': {e}")
        return {}

    duration_s = len(y) / sr

    # RMS energy per second
    hop = sr
    rms = librosa.feature.rms(y=y, frame_length=sr, hop_length=hop)[0]
    if len(rms) < 4:
        return {"duration_s": duration_s, "intro_end_s": 0, "outro_start_s": duration_s, "bpm": 0}

    energy = np.array(rms)
    peak_energy = np.max(energy)
    threshold = peak_energy * 0.5  # 50% of peak as "high energy"

    # Find intro end: first moment energy stays above threshold for 3+ seconds
    intro_end = 0.0
    for i in range(len(energy) - 2):
        if all(energy[i:i + 3] > threshold):
            intro_end = float(i)
            break

    # Find outro start: last moment energy stays above threshold for 3+ seconds
    outro_start = duration_s
    for i in range(len(energy) - 3, 0, -1):
        if all(energy[i:i + 3] > threshold):
            outro_start = float(i + 3)
            break

    # Skip expensive beat_track — BPM is already known from Spotify/Deezer cache
    logger.info(
        f"Transition: '{mp3_path.name}' dur={duration_s:.0f}s "
        f"intro_end={intro_end:.0f}s outro_start={outro_start:.0f}s"
    )

    return {
        "duration_s": duration_s,
        "intro_end_s": intro_end,
        "outro_start_s": outro_start,
        "bpm": 0,
        "energy_curve": energy.tolist(),
    }


def _find_best_segment(energy: list[float], target_s: int, total_s: float,
                       vocal_score: list[float] | None = None) -> tuple[float, float]:
    """Find the segment of target_s seconds with the best combination of
    energy and vocal presence.

    Returns (start_s, end_s). Prefers segments with vocals (singing) over
    purely instrumental sections, while still favouring high energy.
    """
    if len(energy) == 0 or total_s <= target_s:
        return (0.0, total_s)

    n = len(energy)
    window = min(target_s, n)
    n_positions = n - window + 1
    if n_positions <= 0:
        return (0.0, total_s)

    energy_arr = np.array(energy, dtype=np.float64)
    vocal_arr = np.array(vocal_score, dtype=np.float64) if vocal_score and len(vocal_score) >= n else None

    # Vectorized rolling mean energy via cumsum
    cumsum = np.concatenate(([0.0], np.cumsum(energy_arr)))
    avg_energies = (cumsum[window:window + n_positions] - cumsum[:n_positions]) / window

    # Intro/outro bonus arrays
    starts = np.arange(n_positions)
    intro_bonus = np.where(starts >= 5, 1.0, 0.7)
    outro_limit = n - max(5, n // 10)
    outro_penalty = np.where(starts + window <= outro_limit, 1.0, 0.8)

    # Boundary bonus: prefer starting at low-energy points
    peak = np.max(energy_arr) + 1e-8
    boundary_bonus = np.ones(n_positions)
    boundary_bonus[1:] = 1.0 + (1.0 - energy_arr[1:n_positions] / peak) * 0.3

    # Vocal bonus: rolling mean of vocal presence
    vocal_bonus = np.ones(n_positions)
    if vocal_arr is not None:
        v_cumsum = np.concatenate(([0.0], np.cumsum(vocal_arr[:n])))
        v_end = np.minimum(starts + window, len(vocal_arr)).astype(int)
        v_start = starts.astype(int)
        v_sums = np.array([v_cumsum[e] - v_cumsum[s] for s, e in zip(v_start, v_end)])
        v_lens = (v_end - v_start).astype(np.float64)
        v_lens[v_lens == 0] = 1.0
        avg_vocal = v_sums / v_lens
        vocal_bonus = 1.0 + avg_vocal * 1.5

    scores = avg_energies * intro_bonus * outro_penalty * boundary_bonus * vocal_bonus
    best_start = int(np.argmax(scores))

    start_s = float(best_start)
    end_s = float(best_start + window)
    return (start_s, min(end_s, total_s))


def _trim_track(mp3_path: Path, target_s: int, out_path: Path, track_id: str | None = None) -> bool:
    """Analyze and trim a track to the best segment of target_s seconds.

    If the track is already shorter than target_s + 30s, keep it as-is.
    Applies short fade-in/fade-out to avoid clicks at cut points.
    """
    source_size = 0
    try:
        source_size = mp3_path.stat().st_size
    except Exception:
        source_size = 0

    if track_id and source_size > 0:
        cached_trim = _get_cached_trimmed_track(track_id, target_s, source_size)
        if cached_trim:
            _hardlink_or_copy(cached_trim, out_path)
            logger.info(f"Trim cache: hit for '{track_id}' target={target_s}s")
            return True

    # Get track duration
    probe_cmd = [
        "ffprobe", "-v", "quiet", "-show_entries", "format=duration",
        "-of", "csv=p=0", str(mp3_path)
    ]
    try:
        result = subprocess.run(probe_cmd, capture_output=True, text=True, timeout=10)
        total_s = float(result.stdout.strip())
    except Exception:
        logger.warning(f"Trim: can't probe duration for '{mp3_path.name}', skipping trim")
        shutil.copy(str(mp3_path), str(out_path))
        return True

    # Don't trim if track is within tolerance
    if total_s <= target_s + 30:
        logger.info(f"Trim: '{mp3_path.name}' is {total_s:.0f}s, no trim needed (target {target_s}s)")
        _hardlink_or_copy(mp3_path, out_path)
        if track_id and source_size > 0:
            _store_trimmed_track_cache(track_id, target_s, source_size, out_path)
        return True

    logger.info(f"Trim: analyzing '{mp3_path.name}' ({total_s:.0f}s → target {target_s}s)")

    # Single-load combined analysis (energy + vocal in one librosa.load)
    energy, vocal_score = _analyze_for_trim(mp3_path)
    if not energy:
        # Analysis failed, just take from 15s to target_s+15s (skip intro)
        start_s = min(15.0, total_s * 0.1)
        end_s = min(start_s + target_s, total_s)
    else:
        start_s, end_s = _find_best_segment(energy, target_s, total_s, vocal_score)

    duration = end_s - start_s
    fade_s = 2  # 2s fade in/out at cut points

    # Log vocal info for debugging
    if vocal_score:
        v_start = int(start_s)
        v_end = min(int(end_s), len(vocal_score))
        avg_vocal = np.mean(vocal_score[v_start:v_end]) if v_end > v_start else 0
        logger.info(f"Trim: best segment {start_s:.0f}s-{end_s:.0f}s ({duration:.0f}s) vocal={avg_vocal:.2f}")
    else:
        logger.info(f"Trim: best segment {start_s:.0f}s-{end_s:.0f}s ({duration:.0f}s)")

    # Use ffmpeg to trim with fade
    fade_filter = f"afade=t=in:st=0:d={fade_s},afade=t=out:st={duration - fade_s}:d={fade_s}"

    cmd = [
        "ffmpeg", "-y",
        "-ss", f"{start_s:.2f}",
        "-i", str(mp3_path),
        "-t", f"{duration:.2f}",
        "-af", fade_filter,
        "-b:a", "192k",
        str(out_path),
    ]

    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
        if result.returncode != 0:
            logger.error(f"Trim: ffmpeg error: {result.stderr[-300:]}")
            # Fallback: copy untrimmed
            shutil.copy(str(mp3_path), str(out_path))
            return True
        if track_id and source_size > 0:
            _store_trimmed_track_cache(track_id, target_s, source_size, out_path)
        return True
    except Exception as e:
        logger.error(f"Trim: failed: {e}")
        shutil.copy(str(mp3_path), str(out_path))
        return True


_CONCAT_BATCH_SIZE = _MIX_CONCAT_BATCH_SIZE  # small batch size enables step-by-step concat


def _concat_single_pass(
    track_files: list[Path],
    transitions: list[dict],
    default_crossfade_s: int,
    output: Path,
    progress_cb: Callable[[float], None] | None = None,
) -> bool:
    """Run a single ffmpeg invocation to crossfade a (small) list of tracks."""
    n = len(track_files)
    if n == 0:
        return False
    if n == 1:
        shutil.copy(str(track_files[0]), str(output))
        return True

    while len(transitions) < n - 1:
        transitions.append({"style": "crossfade", "duration": default_crossfade_s})

    inputs = []
    for f in track_files:
        inputs.extend(["-i", str(f)])

    def _get_crossfade_params(t: dict) -> str:
        style = t.get("style", "crossfade")
        dur = max(1, min(t.get("duration", default_crossfade_s), 15))
        if style == "cut":
            dur = 0
        if dur == 0:
            return f"d=0.05:c1=tri:c2=tri"
        if style == "fade":
            return f"d={dur}:c1=exp:c2=exp"
        if style == "echo":
            return f"d={dur}:c1=log:c2=qsin"
        if style == "beatmatch":
            return f"d={dur}:c1=qsin:c2=qsin"
        return f"d={dur}:c1=tri:c2=tri"

    if n == 2:
        params = _get_crossfade_params(transitions[0])
        filter_str = f"[0][1]acrossfade={params}"
    else:
        filter_parts = []
        for i in range(1, n):
            params = _get_crossfade_params(transitions[i - 1])
            inp_left = f"[{0}]" if i == 1 else f"[cf{i-1}]"
            inp_right = f"[{i}]"
            out_label = f"[cf{i}]" if i < n - 1 else ""
            filter_parts.append(f"{inp_left}{inp_right}acrossfade={params}{out_label}")
        filter_str = ";".join(filter_parts)

    cmd = [
        "ffmpeg", "-y",
        *inputs,
        "-filter_complex", filter_str,
        "-b:a", "192k",
        "-progress", "pipe:1",
        str(output),
    ]

    logger.info(f"Mix: running ffmpeg concat ({n} tracks)")
    try:
        import tempfile as _tf
        stderr_file = _tf.TemporaryFile(mode="w+", encoding="utf-8")
        proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=stderr_file, text=True)
        while True:
            line = proc.stdout.readline()
            if not line and proc.poll() is not None:
                break
            if line.startswith("out_time_us=") and progress_cb:
                try:
                    us = int(line.split("=", 1)[1].strip())
                    if us > 0:
                        progress_cb(us / 1_000_000)
                except (ValueError, IndexError):
                    pass
        proc.wait(timeout=1800)
        if proc.returncode != 0:
            stderr_file.seek(0)
            stderr_tail = stderr_file.read()[-500:]
            stderr_file.close()
            logger.error(f"Mix: ffmpeg error: {stderr_tail}")
            return False
        stderr_file.close()
        logger.info(f"Mix: output {output.stat().st_size // (1024*1024)}MB")
        return True
    except subprocess.TimeoutExpired:
        proc.kill()
        stderr_file.close()
        logger.error("Mix: ffmpeg timed out")
        return False


def _concat_with_transitions(
    track_files: list[Path],
    transitions: list[dict],
    default_crossfade_s: int,
    output: Path,
    progress_cb: Callable[[float], None] | None = None,
    level: int = 0,
) -> bool:
    """Concatenate tracks with per-pair transition styles, batching if needed.

    Uses small groups to build the final mix progressively, reducing CPU spikes
    vs one huge ffmpeg graph for large playlists.
    """
    n = len(track_files)
    if n <= _CONCAT_BATCH_SIZE:
        return _concat_single_pass(track_files, transitions, default_crossfade_s, output, progress_cb)

    # --- Batched concat for large playlists ---
    logger.info(f"Mix: batching level={level} {n} tracks into groups of {_CONCAT_BATCH_SIZE}")

    while len(transitions) < n - 1:
        transitions.append({"style": "crossfade", "duration": default_crossfade_s})

    batch_base_s = [0.0]

    def _batch_progress(seconds: float) -> None:
        if progress_cb:
            progress_cb(batch_base_s[0] + seconds)

    batch_outputs: list[Path] = []
    batch_join_transitions: list[dict] = []

    start = 0
    batch_idx = 0
    try:
        while start < n:
            end = min(start + _CONCAT_BATCH_SIZE, n)
            batch_tracks = track_files[start:end]
            batch_trans = transitions[start:end - 1] if end - start > 1 else []

            # Include recursion level in temp filename to avoid in-place collisions.
            batch_out = output.parent / f"_batch_l{level}_{batch_idx:03d}.mp3"
            logger.info(f"Mix: batch {batch_idx} — tracks {start}..{end - 1} ({len(batch_tracks)} tracks)")

            ok = _concat_single_pass(batch_tracks, batch_trans, default_crossfade_s, batch_out, _batch_progress)
            if not ok:
                return False

            batch_outputs.append(batch_out)

            # Save the transition between this batch and the next
            if end < n:
                batch_join_transitions.append(transitions[end - 1])

            # Update accumulated seconds for progress tracking
            batch_crossfade = sum(t.get("duration", default_crossfade_s) for t in batch_trans)
            batch_dur_estimate = len(batch_tracks) * 180 - batch_crossfade
            batch_base_s[0] += max(batch_dur_estimate, 10)

            start = end
            batch_idx += 1

        # Merge batch outputs (recursive — will batch again if > _CONCAT_BATCH_SIZE batches)
        if len(batch_outputs) == 1:
            shutil.move(str(batch_outputs[0]), str(output))
            return True

        logger.info(f"Mix: merging level={level} {len(batch_outputs)} batch outputs")
        ok = _concat_with_transitions(
            batch_outputs,
            batch_join_transitions,
            default_crossfade_s,
            output,
            _batch_progress,
            level + 1,
        )
        return ok

    finally:
        for bf in batch_outputs:
            bf.unlink(missing_ok=True)


def _pick_auto_transition(info_a: dict, info_b: dict, default_dur: int) -> dict:
    """Pick the best transition style between track A and track B based on analysis."""
    if not info_a or not info_b:
        return {"style": "crossfade", "duration": default_dur}

    bpm_a = info_a.get("bpm", 0)
    bpm_b = info_b.get("bpm", 0)

    # If BPMs are close (within 5%), use beatmatch-style crossfade
    if bpm_a > 0 and bpm_b > 0:
        ratio = max(bpm_a, bpm_b) / max(min(bpm_a, bpm_b), 1)
        if ratio < 1.05:
            # BPMs are similar: longer smooth crossfade
            return {"style": "beatmatch", "duration": min(default_dur + 2, 15)}

    # If track A has a clear outro (energy drops in last section), use fade
    energy_a = info_a.get("energy_curve", [])
    if len(energy_a) > 10:
        last_quarter = energy_a[-(len(energy_a) // 4):]
        first_half = energy_a[:len(energy_a) // 2]
        if np.mean(last_quarter) < np.mean(first_half) * 0.4:
            return {"style": "fade", "duration": default_dur}

    # Default: standard crossfade
    return {"style": "crossfade", "duration": default_dur}


async def generate_mix(
    tracks: list[dict],
    crossfade_s: int,
    on_progress: Callable[[str, int, int, str], Awaitable[None]],
    target_duration_s: int = 0,
    transition_style: str = "crossfade",
    transitions_override: list[dict] | None = None,
    playlist_id: str = "",
) -> str | None:
    """
    Generate a single MP3 mix from a list of tracks.

    tracks: list of {"id": str, "name": str, "artist": str, "duration_ms": int (optional)}
    crossfade_s: crossfade duration in seconds
    on_progress: async callback(status, current, total, detail)
    target_duration_s: target duration per track in seconds (0 = no trimming)
    transition_style: global style ("crossfade", "fade", "cut", "echo", "beatmatch", "auto")
    transitions_override: per-pair overrides [{"style": str, "duration": int}, ...]

    Returns mix_id for download, or None on failure.
    """
    work_dir = Path(tempfile.mkdtemp(dir=str(MIX_DIR)))
    total = len(tracks)
    downloaded: list[Path] = []
    downloaded_track_ids: list[str] = []
    skipped: list[str] = []

    try:
        # Download tracks with limited parallelism
        _dl_semaphore = asyncio.Semaphore(_MIX_DOWNLOAD_CONCURRENCY)
        n_cached = 0
        n_downloaded = 0
        track_results: list[tuple | None] = [None] * total

        async def _download_one(idx: int, t: dict) -> None:
            async with _dl_semaphore:
                cached = _get_cached_track(t["id"])
                out_path = work_dir / f"{idx:03d}.mp3"
                dur_ms = t.get("duration_ms", 0)
                loop = asyncio.get_event_loop()
                ok = await loop.run_in_executor(
                    _executor, _download_full_track, t["id"], t["artist"], t["name"], out_path, dur_ms
                )
                track_results[idx] = (ok, cached is not None, out_path)
                status = "cached" if cached else ("downloaded" if ok else "skipped")
                await on_progress(status, idx + 1, total, f"{t['artist']} - {t['name']}")

        dl_tasks = [_download_one(i, t) for i, t in enumerate(tracks)]
        await asyncio.gather(*dl_tasks)

        # Collect results in order
        for i in range(total):
            result = track_results[i]
            if result is None:
                skipped.append(f"{tracks[i]['artist']} - {tracks[i]['name']}")
                continue
            ok, was_cached, out_path = result
            if ok:
                downloaded.append(out_path)
                downloaded_track_ids.append(tracks[i]["id"])
                if was_cached:
                    n_cached += 1
                else:
                    n_downloaded += 1
            else:
                skipped.append(f"{tracks[i]['artist']} - {tracks[i]['name']}")

        if len(downloaded) < 1:
            await on_progress("error", 0, total, "Aucune piste téléchargée")
            return None

        if skipped:
            logger.warning(f"Mix: {len(skipped)} piste(s) manquante(s): {skipped}")

        await on_progress("downloaded", total, total,
                          f"✓ {n_downloaded} téléchargée(s), {n_cached} en cache, {len(skipped)} échouée(s)")

        # Trim tracks by small batches to avoid CPU spikes on large playlists
        if target_duration_s > 0:
            n_trim = len(downloaded)
            await on_progress("trimming", 0, n_trim,
                              f"Découpe de {n_trim} pistes (x{_MIX_TRIM_CONCURRENCY} max en parallèle)...")
            loop = asyncio.get_event_loop()
            trimmed_paths: list[Path] = []
            trim_done = 0

            for batch_start in range(0, n_trim, _MIX_TRIM_CONCURRENCY):
                batch_end = min(batch_start + _MIX_TRIM_CONCURRENCY, n_trim)
                batch_futures = []

                for i in range(batch_start, batch_end):
                    dl_path = downloaded[i]
                    track_id = downloaded_track_ids[i]
                    trimmed_path = work_dir / f"trimmed_{i:03d}.mp3"
                    trimmed_paths.append(trimmed_path)
                    batch_futures.append(loop.run_in_executor(
                        _executor, _trim_track, dl_path, target_duration_s, trimmed_path, track_id
                    ))

                await asyncio.gather(*batch_futures)

                for _ in batch_futures:
                    trim_done += 1
                    await on_progress("trimming", trim_done, n_trim,
                                      f"Découpe {trim_done}/{n_trim}")

            await on_progress("trimming", n_trim, n_trim,
                              f"✓ {n_trim} pistes découpées")
            downloaded = trimmed_paths

        # Build transition list
        n_trans = len(downloaded) - 1
        if transitions_override and len(transitions_override) >= n_trans:
            mix_transitions = transitions_override[:n_trans]
        elif transition_style == "auto" and n_trans > 0:
            # Analyze tracks by small batches to cap CPU usage
            await on_progress(
                "analyzing",
                0,
                n_trans,
                f"Analyse des transitions (x{_MIX_ANALYSIS_CONCURRENCY} max en parallèle)...",
            )
            loop = asyncio.get_event_loop()
            all_infos: list[dict] = [{} for _ in range(len(downloaded))]
            analyzed_done = 0

            for batch_start in range(0, len(downloaded), _MIX_ANALYSIS_CONCURRENCY):
                batch_end = min(batch_start + _MIX_ANALYSIS_CONCURRENCY, len(downloaded))
                batch_futures = [
                    loop.run_in_executor(_executor, _analyze_transition_points, downloaded[i])
                    for i in range(batch_start, batch_end)
                ]
                batch_results = await asyncio.gather(*batch_futures)

                for idx, info in enumerate(batch_results):
                    track_index = batch_start + idx
                    all_infos[track_index] = info
                    analyzed_done += 1
                    progress_current = min(analyzed_done, n_trans)
                    await on_progress(
                        "analyzing",
                        progress_current,
                        n_trans,
                        f"Analyse {progress_current}/{n_trans}",
                    )

            mix_transitions = []
            for i in range(n_trans):
                trans = _pick_auto_transition(all_infos[i], all_infos[i + 1], crossfade_s)
                mix_transitions.append(trans)
                logger.info(f"Auto transition {i}→{i+1}: {trans}")
            await on_progress("analyzing", n_trans, n_trans, "✓ Transitions analysées")
        else:
            mix_transitions = [{"style": transition_style, "duration": crossfade_s}] * n_trans

        # Concatenate — with progress & ETA
        # Estimate total output duration
        total_crossfade = sum(t.get("duration", crossfade_s) for t in mix_transitions)
        total_track_dur = sum(
            (target_duration_s if target_duration_s > 0 else 180)
            for _ in downloaded
        )
        estimated_dur = max(total_track_dur - total_crossfade, 30)

        await on_progress(
            "mixing",
            0,
            int(estimated_dur),
            f"Concaténation progressive de {len(downloaded)} pistes (lots de {_CONCAT_BATCH_SIZE})...",
        )
        mix_id = uuid.uuid4().hex[:12]
        output_path = MIX_DIR / f"{mix_id}.mp3"

        # Shared state for progress from ffmpeg thread
        _encoded_s = [0.0]
        _start_t = [time.monotonic()]

        def _progress_cb(seconds: float) -> None:
            _encoded_s[0] = seconds

        loop = asyncio.get_event_loop()
        concat_future = loop.run_in_executor(
            _executor, _concat_with_transitions, downloaded, mix_transitions, crossfade_s, output_path, _progress_cb
        )

        # Poll progress while ffmpeg runs
        while not concat_future.done():
            await asyncio.sleep(1)
            cur = _encoded_s[0]
            if cur > 0:
                bounded_cur = min(cur, float(estimated_dur))
                elapsed_t = time.monotonic() - _start_t[0]
                pct = min(bounded_cur / estimated_dur, 0.99)
                if pct > 0.01:
                    eta = elapsed_t / pct * (1 - pct)
                    eta_str = f"{int(eta)}s" if eta < 60 else f"{int(eta // 60)}m{int(eta % 60):02d}s"
                    detail = f"Mixage {int(pct * 100)}% — reste ~{eta_str}"
                else:
                    detail = f"Mixage {int(pct * 100)}%..."
                await on_progress("mixing", int(bounded_cur), int(estimated_dur), detail)

        ok = await concat_future

        if not ok:
            await on_progress("error", 0, 0, "Échec de la concaténation ffmpeg")
            return None

        await on_progress("mixing", int(estimated_dur), int(estimated_dur), "Mixage 100%")

        _mix_files[mix_id] = output_path
        size_mb = output_path.stat().st_size / (1024 * 1024)
        track_names = [f"{t['artist']} - {t['name']}" for t in tracks]
        _add_to_history(playlist_id, mix_id, len(downloaded), track_names, transition_style, crossfade_s, size_mb)
        await on_progress("done", total, total, f"Mix prêt ({size_mb:.0f}MB)")
        return mix_id

    finally:
        # Clean up individual track files
        for f in downloaded:
            f.unlink(missing_ok=True)
        if work_dir.exists() and not any(work_dir.iterdir()):
            work_dir.rmdir()


# ── Transition preview ──────────────────────────────────────────────

TRANSITION_DIR = Path("/app/cache/transitions")
TRANSITION_DIR.mkdir(parents=True, exist_ok=True)

_MAX_TRANSITION_CACHE = 50
_SEGMENT_DURATION_S = 20


def _get_crossfade_params_for_style(style: str, duration: int) -> str:
    """Return acrossfade filter params for the given style."""
    dur = max(1, min(duration, 15))
    if style == "cut":
        return "d=0.05:c1=tri:c2=tri"
    if style == "fade":
        return f"d={dur}:c1=exp:c2=exp"
    if style == "echo":
        return f"d={dur}:c1=log:c2=qsin"
    if style == "beatmatch":
        return f"d={dur}:c1=qsin:c2=qsin"
    return f"d={dur}:c1=tri:c2=tri"


def _cleanup_transition_cache() -> None:
    """Keep only the most recent _MAX_TRANSITION_CACHE transition previews."""
    files = sorted(TRANSITION_DIR.glob("*.mp3"), key=lambda f: f.stat().st_mtime)
    while len(files) > _MAX_TRANSITION_CACHE:
        oldest = files.pop(0)
        oldest.unlink(missing_ok=True)


def _probe_duration(mp3_path: Path) -> float:
    """Get duration of MP3 in seconds via ffprobe."""
    result = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "default=noprint_wrappers=1:nokey=1", str(mp3_path)],
        capture_output=True, text=True, timeout=10,
    )
    try:
        return float(result.stdout.strip())
    except (ValueError, AttributeError):
        return 0.0


def _generate_transition_preview_sync(
    from_id: str, to_id: str,
    from_artist: str, from_name: str,
    to_artist: str, to_name: str,
    style: str, duration: int,
) -> Path | None:
    """Generate a short crossfade preview between two tracks (blocking)."""
    cache_key = f"{from_id}_{to_id}_{style}_{duration}"
    output = TRANSITION_DIR / f"{cache_key}.mp3"

    if output.exists() and output.stat().st_size > 1000:
        return output

    work_dir = TRANSITION_DIR / f"_work_{cache_key}"
    work_dir.mkdir(parents=True, exist_ok=True)

    track_a = work_dir / "a_full.mp3"
    track_b = work_dir / "b_full.mp3"
    seg_a = work_dir / "seg_a.mp3"
    seg_b = work_dir / "seg_b.mp3"

    try:
        # Download tracks (uses cache)
        if not _download_full_track(from_id, from_artist, from_name, track_a):
            logger.error(f"TransPreview: failed to download track A '{from_artist} - {from_name}'")
            return None
        if not _download_full_track(to_id, to_artist, to_name, track_b):
            logger.error(f"TransPreview: failed to download track B '{to_artist} - {to_name}'")
            return None

        # Get durations
        dur_a = _probe_duration(track_a)
        dur_b = _probe_duration(track_b)
        if dur_a < 5 or dur_b < 5:
            logger.error(f"TransPreview: tracks too short (A={dur_a:.0f}s, B={dur_b:.0f}s)")
            return None

        seg_len = min(_SEGMENT_DURATION_S, dur_a - 2, dur_b - 2)
        seg_len = max(seg_len, 5)

        # Extract last seg_len seconds of track A with fade-out at the very end
        start_a = max(0, dur_a - seg_len)
        cmd_a = [
            "ffmpeg", "-y", "-ss", f"{start_a:.2f}", "-i", str(track_a),
            "-t", f"{seg_len:.2f}",
            "-b:a", "192k", str(seg_a),
        ]

        # Extract first seg_len seconds of track B
        cmd_b = [
            "ffmpeg", "-y", "-t", f"{seg_len:.2f}", "-i", str(track_b),
            "-b:a", "192k", str(seg_b),
        ]

        for cmd in [cmd_a, cmd_b]:
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
            if result.returncode != 0:
                logger.error(f"TransPreview: trim failed: {result.stderr[-300:]}")
                return None

        # Apply crossfade
        params = _get_crossfade_params_for_style(style, duration)
        cmd_mix = [
            "ffmpeg", "-y",
            "-i", str(seg_a), "-i", str(seg_b),
            "-filter_complex", f"[0][1]acrossfade={params}",
            "-b:a", "192k", str(output),
        ]

        result = subprocess.run(cmd_mix, capture_output=True, text=True, timeout=60)
        if result.returncode != 0:
            logger.error(f"TransPreview: crossfade failed: {result.stderr[-300:]}")
            return None

        logger.info(f"TransPreview: generated {output.name} ({output.stat().st_size // 1024}KB)")
        _cleanup_transition_cache()
        return output

    except subprocess.TimeoutExpired:
        logger.error("TransPreview: ffmpeg timed out")
        return None
    except Exception as e:
        logger.error(f"TransPreview: unexpected error: {e}")
        return None
    finally:
        # Clean up work dir
        shutil.rmtree(str(work_dir), ignore_errors=True)


async def generate_transition_preview(
    from_id: str, to_id: str,
    from_artist: str, from_name: str,
    to_artist: str, to_name: str,
    style: str = "crossfade", duration: int = 8,
) -> Path | None:
    """Async wrapper for transition preview generation."""
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(
        _executor,
        _generate_transition_preview_sync,
        from_id, to_id, from_artist, from_name, to_artist, to_name, style, duration,
    )


def get_mix_path(mix_id: str) -> Path | None:
    """Get path to a generated mix file."""
    # Check in-memory registry
    if mix_id in _mix_files:
        p = _mix_files[mix_id]
        if p.exists():
            return p
    # Check on disk (survives restart)
    p = MIX_DIR / f"{mix_id}.mp3"
    if p.exists():
        return p
    return None


def cleanup_old_mixes(max_age_hours: int = 1) -> None:
    """Remove mix files older than max_age_hours, keeping history entries."""
    history_ids = _all_history_mix_ids()
    now = time.time()
    for f in MIX_DIR.glob("*.mp3"):
        if f.stem in history_ids:
            continue  # keep history mixes
        if now - f.stat().st_mtime > max_age_hours * 3600:
            f.unlink(missing_ok=True)
            _mix_files.pop(f.stem, None)
