from __future__ import annotations
import asyncio
import json
import logging
import shutil
import subprocess
import tempfile
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Callable, Awaitable

import numpy as np
import yt_dlp
from ytmusicapi import YTMusic

logger = logging.getLogger(__name__)
_executor = ThreadPoolExecutor(max_workers=3)
_ytmusic = YTMusic()

MIX_DIR = Path("/app/cache/mixes")
MIX_DIR.mkdir(parents=True, exist_ok=True)

TRACK_CACHE_DIR = Path("/app/cache/tracks")
TRACK_CACHE_DIR.mkdir(parents=True, exist_ok=True)

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


def _search_ytmusic(artist: str, title: str, duration_ms: int = 0) -> str | None:
    """Search YouTube Music for the best matching video ID."""
    try:
        results = _ytmusic.search(f"{artist} {title}", filter="songs", limit=5)
        if not results:
            results = _ytmusic.search(f"{artist} {title}", filter="videos", limit=5)
        if not results:
            return None

        # If we have a duration, pick the closest match
        if duration_ms > 0:
            target_s = duration_ms / 1000
            best = None
            best_diff = float("inf")
            for r in results:
                vid_id = r.get("videoId")
                if not vid_id:
                    continue
                dur_s = r.get("duration_seconds") or 0
                diff = abs(dur_s - target_s)
                if diff < best_diff:
                    best_diff = diff
                    best = vid_id
            if best and best_diff < 30:  # within 30s tolerance
                logger.info(f"YTMusic: matched '{artist} - {title}' → {best} (Δ{best_diff:.0f}s)")
                return best

        # Fallback: first result
        vid_id = results[0].get("videoId")
        if vid_id:
            logger.info(f"YTMusic: matched '{artist} - {title}' → {vid_id}")
            return vid_id
    except Exception as e:
        logger.warning(f"YTMusic search failed for '{artist} - {title}': {e}")
    return None


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


def _download_full_track(track_id: str, artist: str, title: str, out_path: Path, duration_ms: int = 0) -> bool:
    """Download full track: YT Music search → fallback generic YouTube search."""
    # Check cache first
    cached = _get_cached_track(track_id)
    if cached:
        shutil.copy(str(cached), str(out_path))
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
        f"{artist} {title} audio",
        f"{artist} {title}",
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


def _analyze_energy_curve(mp3_path: Path) -> list[float]:
    """Analyze an MP3 and return per-second RMS energy values."""
    import librosa

    try:
        y, sr = librosa.load(str(mp3_path), sr=22050, mono=True)
    except Exception as e:
        logger.error(f"Trim: failed to load '{mp3_path.name}': {e}")
        return []

    # Compute RMS energy in 1-second windows
    hop = sr  # 1 second
    frame_length = sr
    rms = librosa.feature.rms(y=y, frame_length=frame_length, hop_length=hop)[0]
    return rms.tolist()


def _analyze_vocal_presence(mp3_path: Path) -> list[float]:
    """Estimate per-second vocal likelihood using spectral band analysis.

    Computes the ratio of energy in the vocal frequency range (300-3500 Hz)
    to total energy. Sections with singing have a higher ratio.
    """
    import librosa

    try:
        y, sr = librosa.load(str(mp3_path), sr=22050, mono=True)
    except Exception as e:
        logger.error(f"Vocal: failed to load '{mp3_path.name}': {e}")
        return []

    # Mel spectrogram with standard parameters
    S = librosa.feature.melspectrogram(y=y, sr=sr, n_mels=128, hop_length=512)

    # Find mel bins corresponding to vocal frequency range
    mel_freqs = librosa.mel_frequencies(n_mels=128, fmin=0.0, fmax=float(sr) / 2)
    vocal_low = int(np.searchsorted(mel_freqs, 300))
    vocal_high = int(np.searchsorted(mel_freqs, 3500))

    total = np.sum(S, axis=0) + 1e-10
    vocal = np.sum(S[vocal_low:vocal_high], axis=0)
    vocal_ratio = vocal / total

    # Aggregate to per-second (sr / hop_length frames per second)
    fps = sr // 512
    n_seconds = len(vocal_ratio) // fps
    per_second = []
    for i in range(n_seconds):
        chunk = vocal_ratio[i * fps : (i + 1) * fps]
        per_second.append(float(np.mean(chunk)))

    return per_second


def _analyze_transition_points(mp3_path: Path) -> dict:
    """Analyze a track to find optimal transition in/out points.

    Returns {"duration_s", "intro_end_s", "outro_start_s", "bpm", "energy_curve"}.
    - intro_end_s: when the track reaches full energy (good entry point ends)
    - outro_start_s: when energy starts dropping (good exit point starts)
    """
    import librosa

    try:
        y, sr = librosa.load(str(mp3_path), sr=22050, mono=True)
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

    # BPM
    tempo, _ = librosa.beat.beat_track(y=y, sr=sr)
    if isinstance(tempo, np.ndarray):
        tempo = float(tempo[0])

    logger.info(
        f"Transition: '{mp3_path.name}' dur={duration_s:.0f}s "
        f"intro_end={intro_end:.0f}s outro_start={outro_start:.0f}s bpm={tempo:.0f}"
    )

    return {
        "duration_s": duration_s,
        "intro_end_s": intro_end,
        "outro_start_s": outro_start,
        "bpm": tempo,
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

    best_start = 0
    best_score = -1.0

    energy_arr = np.array(energy)
    vocal_arr = np.array(vocal_score) if vocal_score and len(vocal_score) >= n else None

    for start in range(n - window + 1):
        segment = energy_arr[start:start + window]
        avg_energy = float(np.mean(segment))

        # Bonus: prefer segments that don't start in the first 5s (skip intro)
        # and don't start in the last 10% (skip outro)
        intro_bonus = 1.0 if start >= 5 else 0.7
        outro_penalty = 1.0 if start + window <= n - max(5, n // 10) else 0.8

        # Bonus: prefer segments starting at a low-energy point (natural transition)
        boundary_bonus = 1.0
        if start > 0:
            edge_energy = energy_arr[start] / (np.max(energy_arr) + 1e-8)
            boundary_bonus = 1.0 + (1.0 - edge_energy) * 0.3

        # Vocal presence bonus: strongly prefer segments with vocals
        vocal_bonus = 1.0
        if vocal_arr is not None:
            v_end = min(start + window, len(vocal_arr))
            vocal_seg = vocal_arr[start:v_end]
            if len(vocal_seg) > 0:
                avg_vocal = float(np.mean(vocal_seg))
                # Boost up to ~2x for high vocal presence
                vocal_bonus = 1.0 + avg_vocal * 1.5

        score = avg_energy * intro_bonus * outro_penalty * boundary_bonus * vocal_bonus
        if score > best_score:
            best_score = score
            best_start = start

    start_s = float(best_start)
    end_s = float(best_start + window)
    return (start_s, min(end_s, total_s))


def _trim_track(mp3_path: Path, target_s: int, out_path: Path) -> bool:
    """Analyze and trim a track to the best segment of target_s seconds.

    If the track is already shorter than target_s + 30s, keep it as-is.
    Applies short fade-in/fade-out to avoid clicks at cut points.
    """
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
        shutil.copy(str(mp3_path), str(out_path))
        return True

    logger.info(f"Trim: analyzing '{mp3_path.name}' ({total_s:.0f}s → target {target_s}s)")

    # Analyze energy and vocal presence to find best segment
    energy = _analyze_energy_curve(mp3_path)
    vocal_score = _analyze_vocal_presence(mp3_path)
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
    except Exception as e:
        logger.error(f"Trim: failed: {e}")
        shutil.copy(str(mp3_path), str(out_path))
        return True


def _concat_with_transitions(
    track_files: list[Path],
    transitions: list[dict],
    default_crossfade_s: int,
    output: Path,
) -> bool:
    """Concatenate tracks with per-pair transition styles.

    transitions: list of {"style": str, "duration": int} for each pair (len = n-1).
    Styles: "crossfade", "fade", "cut", "echo", "auto".
    """
    n = len(track_files)
    if n == 0:
        return False
    if n == 1:
        shutil.copy(str(track_files[0]), str(output))
        return True

    # Ensure we have n-1 transitions
    while len(transitions) < n - 1:
        transitions.append({"style": "crossfade", "duration": default_crossfade_s})

    # Strategy: chain pairwise operations
    # For complex filters, build a single ffmpeg command
    inputs = []
    for f in track_files:
        inputs.extend(["-i", str(f)])

    # Map each transition style to an acrossfade curve pair
    def _get_crossfade_params(t: dict) -> str:
        style = t.get("style", "crossfade")
        dur = max(1, min(t.get("duration", default_crossfade_s), 15))
        if style == "cut":
            dur = 0
        if dur == 0:
            return f"d=0.05:c1=tri:c2=tri"  # near-instant cut
        if style == "fade":
            # Fade out then fade in (no overlap feel - use exp curves)
            return f"d={dur}:c1=exp:c2=exp"
        if style == "echo":
            # Logarithmic fade out, quick fade in
            return f"d={dur}:c1=log:c2=qsin"
        if style == "beatmatch":
            # Equal power crossfade (smooth for beat-aligned)
            return f"d={dur}:c1=qsin:c2=qsin"
        # Default crossfade: triangle (linear)
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
        str(output),
    ]

    logger.info(f"Mix: running ffmpeg concat ({n} tracks, styles: {[t.get('style') for t in transitions]})")
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=600)
        if result.returncode != 0:
            logger.error(f"Mix: ffmpeg error: {result.stderr[-500:]}")
            return False
        logger.info(f"Mix: output {output.stat().st_size // (1024*1024)}MB")
        return True
    except subprocess.TimeoutExpired:
        logger.error("Mix: ffmpeg timed out")
        return False


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
    skipped: list[str] = []

    try:
        # Download each track
        n_cached = 0
        n_downloaded = 0
        for i, t in enumerate(tracks):
            cached = _get_cached_track(t["id"])
            status = "cached" if cached else "downloading"
            await on_progress(status, i + 1, total, f"{t['artist']} - {t['name']}")
            out_path = work_dir / f"{i:03d}.mp3"
            dur_ms = t.get("duration_ms", 0)
            loop = asyncio.get_event_loop()
            ok = await loop.run_in_executor(
                _executor, _download_full_track, t["id"], t["artist"], t["name"], out_path, dur_ms
            )
            if ok:
                downloaded.append(out_path)
                if cached:
                    n_cached += 1
                else:
                    n_downloaded += 1
            else:
                skipped.append(f"{t['artist']} - {t['name']}")
                await on_progress("skipped", i + 1, total, f"⚠ Échec: {t['artist']} - {t['name']}")

        if len(downloaded) < 1:
            await on_progress("error", 0, total, "Aucune piste téléchargée")
            return None

        if skipped:
            logger.warning(f"Mix: {len(skipped)} piste(s) manquante(s): {skipped}")

        await on_progress("downloaded", total, total,
                          f"✓ {n_downloaded} téléchargée(s), {n_cached} en cache, {len(skipped)} échouée(s)")

        # Trim tracks if target duration is set
        if target_duration_s > 0:
            trimmed: list[Path] = []
            for i, dl_path in enumerate(downloaded):
                await on_progress("trimming", i + 1, len(downloaded),
                                  f"Découpe piste {i + 1}/{len(downloaded)}")
                trimmed_path = work_dir / f"trimmed_{i:03d}.mp3"
                loop = asyncio.get_event_loop()
                await loop.run_in_executor(
                    _executor, _trim_track, dl_path, target_duration_s, trimmed_path
                )
                trimmed.append(trimmed_path)
            downloaded = trimmed

        # Build transition list
        n_trans = len(downloaded) - 1
        if transitions_override and len(transitions_override) >= n_trans:
            mix_transitions = transitions_override[:n_trans]
        elif transition_style == "auto" and n_trans > 0:
            # Analyze each pair to pick the best transition
            mix_transitions = []
            for i in range(n_trans):
                await on_progress("analyzing", i + 1, n_trans,
                                  f"Analyse transition {i + 1}/{n_trans}")
                loop = asyncio.get_event_loop()
                info_a = await loop.run_in_executor(
                    _executor, _analyze_transition_points, downloaded[i]
                )
                info_b = await loop.run_in_executor(
                    _executor, _analyze_transition_points, downloaded[i + 1]
                )
                trans = _pick_auto_transition(info_a, info_b, crossfade_s)
                mix_transitions.append(trans)
                logger.info(f"Auto transition {i}→{i+1}: {trans}")
        else:
            mix_transitions = [{"style": transition_style, "duration": crossfade_s}] * n_trans

        # Concatenate
        await on_progress("mixing", 0, 0, f"Concaténation de {len(downloaded)} pistes...")
        mix_id = uuid.uuid4().hex[:12]
        output_path = MIX_DIR / f"{mix_id}.mp3"

        loop = asyncio.get_event_loop()
        ok = await loop.run_in_executor(
            _executor, _concat_with_transitions, downloaded, mix_transitions, crossfade_s, output_path
        )

        if not ok:
            await on_progress("error", 0, 0, "Échec de la concaténation ffmpeg")
            return None

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
