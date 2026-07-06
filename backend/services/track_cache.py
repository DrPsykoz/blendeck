from __future__ import annotations

import json
import logging
import os
import shutil
import subprocess
import threading
import time
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator

from core import paths
from core.env import int_env

logger = logging.getLogger(__name__)

TRACKS_DIR = paths.TRACKS_DIR

# Duration tolerance when validating a downloaded file against Spotify's
# duration_ms: relative percentage with an absolute floor in seconds.
_DURATION_TOLERANCE_PCT = int_env("TRACK_DURATION_TOLERANCE_PCT", 8, min_value=1, max_value=50)
_DURATION_TOLERANCE_MIN_S = int_env("TRACK_DURATION_TOLERANCE_MIN_S", 10, min_value=1, max_value=60)

# Negative cache: don't re-search YouTube for tracks that recently failed.
_FAIL_TTL_S = int_env("TRACK_DOWNLOAD_FAIL_TTL_H", 24, min_value=1, max_value=336) * 3600
_FAILED_FILE = paths.CACHE_ROOT / "failed_downloads.json"

# LRU bound for the full-track cache (validated tracks are never evicted).
TRACK_CACHE_MAX_GB = int_env("TRACK_CACHE_MAX_GB", 20, min_value=1, max_value=500)

VALIDATED_TRACKS_FILE = paths.CACHE_ROOT / "validated_tracks.json"

_MIN_VALID_BYTES = 1000

# ── Single-flight download locks ─────────────────────────────────────────────
# Downloads run in worker threads (run_in_executor), so plain threading locks
# serialize concurrent attempts on the same track across prefetch and mixes.

_locks: dict[str, threading.Lock] = {}
_locks_guard = threading.Lock()


@contextmanager
def track_lock(track_id: str) -> Iterator[None]:
    with _locks_guard:
        lock = _locks.setdefault(track_id, threading.Lock())
    with lock:
        yield


# ── Cache lookup / atomic store ──────────────────────────────────────────────

def cache_path(track_id: str) -> Path:
    return TRACKS_DIR / f"{track_id}.mp3"


def get(track_id: str, touch: bool = True) -> Path | None:
    """Return the cached MP3 path, or None. Touches mtime so LRU stays honest."""
    path = cache_path(track_id)
    try:
        if path.exists() and path.stat().st_size > _MIN_VALID_BYTES:
            if touch:
                os.utime(path, None)
            return path
    except OSError:
        pass
    return None


def store_atomic(src: Path, dst: Path) -> None:
    """Publish src at dst atomically (temp file + rename on the same fs)."""
    dst.parent.mkdir(parents=True, exist_ok=True)
    tmp = dst.with_name(dst.name + ".part")
    shutil.copy(str(src), str(tmp))
    os.replace(tmp, dst)


# ── Duration validation ──────────────────────────────────────────────────────

def probe_duration_s(path: Path) -> float:
    """Return audio duration in seconds via ffprobe, or 0.0 on failure."""
    try:
        result = subprocess.run(
            ["ffprobe", "-v", "quiet", "-show_entries", "format=duration",
             "-of", "csv=p=0", str(path)],
            capture_output=True, text=True, timeout=15,
        )
        return float(result.stdout.strip())
    except Exception:
        return 0.0


def duration_matches(path: Path, duration_ms: int) -> bool:
    """Check the downloaded file's duration against Spotify's metadata.

    Returns True when duration_ms is unknown (nothing to validate against)
    or when the file is within tolerance. Catches wrong matches like live
    versions and extended mixes before they poison the cache.
    """
    if duration_ms <= 0:
        return True
    actual_s = probe_duration_s(path)
    if actual_s <= 0:
        return True  # ffprobe failed; don't block the download on it
    target_s = duration_ms / 1000
    tolerance = max(target_s * _DURATION_TOLERANCE_PCT / 100, _DURATION_TOLERANCE_MIN_S)
    return abs(actual_s - target_s) <= tolerance


# ── Negative cache (failed downloads) ────────────────────────────────────────

_failed: dict[str, float] | None = None
_failed_guard = threading.Lock()


def _load_failed() -> dict[str, float]:
    global _failed
    if _failed is None:
        try:
            _failed = {
                k: float(v)
                for k, v in json.loads(_FAILED_FILE.read_text()).items()
            } if _FAILED_FILE.exists() else {}
        except Exception:
            _failed = {}
    return _failed


def _save_failed(failed: dict[str, float]) -> None:
    try:
        tmp = _FAILED_FILE.with_suffix(".json.part")
        tmp.write_text(json.dumps(failed))
        os.replace(tmp, _FAILED_FILE)
    except Exception as e:
        logger.warning(f"TrackCache: failed to persist negative cache: {e}")


def is_marked_failed(track_id: str) -> bool:
    with _failed_guard:
        failed = _load_failed()
        ts = failed.get(track_id)
        if ts is None:
            return False
        if time.time() - ts > _FAIL_TTL_S:
            failed.pop(track_id, None)
            _save_failed(failed)
            return False
        return True


def mark_failed(track_id: str) -> None:
    with _failed_guard:
        failed = _load_failed()
        failed[track_id] = time.time()
        # Opportunistic pruning of expired entries
        cutoff = time.time() - _FAIL_TTL_S
        for tid in [t for t, ts in failed.items() if ts < cutoff]:
            failed.pop(tid, None)
        _save_failed(failed)


def clear_failed(track_id: str) -> None:
    with _failed_guard:
        failed = _load_failed()
        if failed.pop(track_id, None) is not None:
            _save_failed(failed)


# ── LRU eviction ─────────────────────────────────────────────────────────────

def _load_validated_ids() -> set[str]:
    try:
        if VALIDATED_TRACKS_FILE.exists():
            data = json.loads(VALIDATED_TRACKS_FILE.read_text())
            if isinstance(data, list):
                return {str(t) for t in data}
    except Exception:
        pass
    return set()


def evict_lru(max_total_gb: int = TRACK_CACHE_MAX_GB, _budget_bytes: int | None = None) -> int:
    """Evict least-recently-used cached tracks above the size budget.

    Admin-validated tracks are protected. Returns the number of files removed.
    """
    try:
        files = [f for f in TRACKS_DIR.glob("*.mp3") if f.is_file()]
    except OSError:
        return 0

    total = sum(f.stat().st_size for f in files)
    budget = _budget_bytes if _budget_bytes is not None else max_total_gb * 1024 ** 3
    if total <= budget:
        return 0

    validated = _load_validated_ids()
    # "<id>.mp3" and "<id>__alt__<video>.mp3" both belong to <id>
    candidates = [
        f for f in files
        if f.name.split("__alt__")[0].removesuffix(".mp3") not in validated
    ]
    candidates.sort(key=lambda f: f.stat().st_mtime)

    removed = 0
    for f in candidates:
        if total <= budget:
            break
        try:
            size = f.stat().st_size
            f.unlink()
            total -= size
            removed += 1
        except OSError:
            continue

    if removed:
        logger.info(
            f"TrackCache: evicted {removed} LRU file(s), cache now {total // 1024 // 1024}MB "
            f"(budget {max_total_gb}GB)"
        )
    return removed
