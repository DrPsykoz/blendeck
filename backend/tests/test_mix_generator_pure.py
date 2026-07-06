import pytest

from services.mix_generator import (
    _bitrate_env,
    _bool_env,
    _bpm_aware_crossfade_s,
    _find_best_segment,
    _has_unwanted_marker,
    _int_env,
    _normalize_text,
    _score_ytmusic_result,
    _tokenize,
)


# --- env helpers -----------------------------------------------------------

def test_int_env_default_when_unset(monkeypatch):
    monkeypatch.delenv("X_TEST_INT", raising=False)
    assert _int_env("X_TEST_INT", 3) == 3


def test_int_env_clamps(monkeypatch):
    monkeypatch.setenv("X_TEST_INT", "99")
    assert _int_env("X_TEST_INT", 3, min_value=1, max_value=8) == 8
    monkeypatch.setenv("X_TEST_INT", "0")
    assert _int_env("X_TEST_INT", 3, min_value=1, max_value=8) == 1


def test_int_env_invalid_falls_back(monkeypatch):
    monkeypatch.setenv("X_TEST_INT", "abc")
    assert _int_env("X_TEST_INT", 3) == 3


def test_bitrate_env(monkeypatch):
    monkeypatch.setenv("X_TEST_BR", "192k")
    assert _bitrate_env("X_TEST_BR") == "192k"
    monkeypatch.setenv("X_TEST_BR", "lossless")
    assert _bitrate_env("X_TEST_BR") == "320k"


def test_bool_env(monkeypatch):
    for truthy in ("1", "true", "YES", "on"):
        monkeypatch.setenv("X_TEST_BOOL", truthy)
        assert _bool_env("X_TEST_BOOL", False) is True
    for falsy in ("0", "false", "No", "off"):
        monkeypatch.setenv("X_TEST_BOOL", falsy)
        assert _bool_env("X_TEST_BOOL", True) is False
    monkeypatch.setenv("X_TEST_BOOL", "peut-etre")
    assert _bool_env("X_TEST_BOOL", True) is True


# --- text matching ---------------------------------------------------------

def test_normalize_text_strips_accents_and_punctuation():
    assert _normalize_text("Édith Piaf — La Vie en Rose!") == "edith piaf la vie en rose"


def test_tokenize_removes_stopwords():
    tokens = _tokenize("The Weeknd feat. Daft Punk (Official Audio)")
    assert "weeknd" in tokens
    assert "daft" in tokens
    assert "official" not in tokens
    assert "feat" not in tokens


def test_unwanted_markers():
    assert _has_unwanted_marker("Song Title (Cover by Someone)")
    assert _has_unwanted_marker("Track — Live at Wembley")
    assert _has_unwanted_marker("Hit (Sped Up)")
    assert not _has_unwanted_marker("Plain Song Title")


# --- YTMusic result scoring -------------------------------------------------

def _yt_result(title: str, artist: str, duration_s: int, channel: str = "") -> dict:
    return {
        "title": title,
        "artists": [{"name": artist}],
        "duration_seconds": duration_s,
        "channel": channel,
        "isExplicit": False,
    }


def test_scoring_prefers_exact_match_over_cover():
    good = _yt_result("Blinding Lights", "The Weeknd", 200, channel="The Weeknd - Topic")
    cover = _yt_result("Blinding Lights (Piano Cover)", "Random Guy", 200)
    target = {"artist": "The Weeknd", "title": "Blinding Lights", "duration_ms": 200_000}
    assert _score_ytmusic_result(good, **target) > _score_ytmusic_result(cover, **target)


def test_scoring_penalizes_wrong_duration():
    right = _yt_result("Song", "Artist", 200)
    extended = _yt_result("Song", "Artist", 400)
    target = {"artist": "Artist", "title": "Song", "duration_ms": 200_000}
    assert _score_ytmusic_result(right, **target) > _score_ytmusic_result(extended, **target)


def test_scoring_handles_missing_fields():
    score = _score_ytmusic_result({}, artist="Artist", title="Song", duration_ms=0)
    assert isinstance(score, float)


# --- crossfade & segment selection ------------------------------------------

def test_bpm_aware_crossfade_stays_positive():
    assert _bpm_aware_crossfade_s(0.0, 0.0, 8) >= 1
    assert _bpm_aware_crossfade_s(128.0, 128.0, 8) >= 1


def test_find_best_segment_short_track_returned_whole():
    start, end = _find_best_segment([0.5] * 20, target_s=60, total_s=20.0)
    assert (start, end) == (0.0, 20.0)


def test_find_best_segment_window_length_and_bounds():
    energy = [0.1] * 30 + [0.9] * 60 + [0.1] * 30
    start, end = _find_best_segment(energy, target_s=60, total_s=120.0)
    assert 0.0 <= start < end <= 120.0
    assert end - start == 60.0


def test_find_best_segment_targets_high_energy_zone():
    energy = [0.05] * 60 + [0.95] * 60 + [0.05] * 60
    start, end = _find_best_segment(energy, target_s=60, total_s=180.0)
    # The selected window should overlap the high-energy middle section
    assert start < 120 and end > 60
    overlap = min(end, 120) - max(start, 60)
    assert overlap >= 30
