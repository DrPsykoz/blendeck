import json
import os
import time

import pytest

from services import track_cache


@pytest.fixture(autouse=True)
def clean_cache_state():
    """Isolate each test: fresh tracks dir content and negative-cache state."""
    track_cache.TRACKS_DIR.mkdir(parents=True, exist_ok=True)
    for f in track_cache.TRACKS_DIR.glob("*"):
        f.unlink()
    track_cache._failed = {}
    track_cache._FAILED_FILE.unlink(missing_ok=True)
    track_cache.VALIDATED_TRACKS_FILE.unlink(missing_ok=True)
    yield


def _write_track(track_id: str, size: int = 2000, mtime: float | None = None):
    path = track_cache.cache_path(track_id)
    path.write_bytes(b"x" * size)
    if mtime is not None:
        os.utime(path, (mtime, mtime))
    return path


def test_get_returns_none_for_missing_or_tiny_file(tmp_path):
    assert track_cache.get("missing") is None
    _write_track("tiny", size=10)
    assert track_cache.get("tiny") is None


def test_get_touches_mtime_for_lru():
    old = time.time() - 90_000
    path = _write_track("t1", mtime=old)
    assert track_cache.get("t1") == path
    assert path.stat().st_mtime > old + 80_000


def test_store_atomic_publishes_and_leaves_no_temp(tmp_path):
    src = tmp_path / "src.mp3"
    src.write_bytes(b"y" * 5000)
    dst = track_cache.cache_path("stored")
    track_cache.store_atomic(src, dst)
    assert dst.read_bytes() == b"y" * 5000
    assert not list(track_cache.TRACKS_DIR.glob("*.part"))


def test_negative_cache_roundtrip():
    assert not track_cache.is_marked_failed("t1")
    track_cache.mark_failed("t1")
    assert track_cache.is_marked_failed("t1")
    track_cache.clear_failed("t1")
    assert not track_cache.is_marked_failed("t1")


def test_negative_cache_expires(monkeypatch):
    track_cache.mark_failed("t1")
    monkeypatch.setattr(track_cache, "_FAIL_TTL_S", 1)
    track_cache._failed["t1"] = time.time() - 10
    assert not track_cache.is_marked_failed("t1")


def test_negative_cache_persisted_on_disk():
    track_cache.mark_failed("t1")
    data = json.loads(track_cache._FAILED_FILE.read_text())
    assert "t1" in data


def test_duration_matches_unknown_target():
    assert track_cache.duration_matches(track_cache.cache_path("x"), 0)


def test_duration_matches_within_tolerance(monkeypatch):
    monkeypatch.setattr(track_cache, "probe_duration_s", lambda p: 200.0)
    assert track_cache.duration_matches(track_cache.cache_path("x"), 205_000)
    assert not track_cache.duration_matches(track_cache.cache_path("x"), 300_000)


def test_evict_lru_removes_oldest_first():
    now = time.time()
    _write_track("old", size=600_000, mtime=now - 1000)
    _write_track("mid", size=600_000, mtime=now - 500)
    _write_track("new", size=600_000, mtime=now)
    # Budget fits exactly two files → only the oldest is evicted
    removed = track_cache.evict_lru(_budget_bytes=1_200_000)
    assert removed == 1
    assert not track_cache.cache_path("old").exists()
    assert track_cache.cache_path("mid").exists()
    assert track_cache.cache_path("new").exists()


def test_evict_lru_protects_validated_tracks():
    now = time.time()
    _write_track("keepme", size=600_000, mtime=now - 1000)
    _write_track("dropme", size=600_000, mtime=now - 900)
    track_cache.VALIDATED_TRACKS_FILE.write_text(json.dumps(["keepme"]))
    removed = track_cache.evict_lru(max_total_gb=0)
    assert removed == 1
    assert track_cache.cache_path("keepme").exists()
    assert not track_cache.cache_path("dropme").exists()


def test_evict_lru_noop_under_budget():
    _write_track("small", size=2000)
    assert track_cache.evict_lru(max_total_gb=1) == 0
    assert track_cache.cache_path("small").exists()
