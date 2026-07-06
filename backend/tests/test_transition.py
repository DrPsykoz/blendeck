import pytest

from models.track import AudioFeatures, Track
from services.camelot import to_camelot
from services.transition import (
    bpm_compatibility,
    danceability_similarity,
    energy_flow_score,
    score_transition,
    year_proximity_score,
)


def make_track(track_id: str, tempo: float = 120.0, key: int = 0, mode: int = 1,
               energy: float = 0.5, danceability: float = 0.5,
               year: int | None = 2020) -> Track:
    features = AudioFeatures(
        tempo=tempo, key=key, mode=mode, energy=energy,
        danceability=danceability, valence=0.5, loudness=-8.0,
    )
    return Track(
        id=track_id, name=f"Track {track_id}", artists=["Artist"], album="Album",
        duration_ms=200_000, uri=f"spotify:track:{track_id}",
        release_year=year, audio_features=features, camelot=to_camelot(key, mode),
    )


def test_bpm_exact_match():
    assert bpm_compatibility(128.0, 128.0) == 1.0


def test_bpm_within_tolerance():
    assert bpm_compatibility(128.0, 131.0) == 1.0


def test_bpm_far_apart_is_zero():
    assert bpm_compatibility(100.0, 115.0) == 0.0


def test_bpm_midpoint_linear():
    assert bpm_compatibility(100.0, 109.0) == pytest.approx(0.5)


def test_bpm_double_time_counts_as_match():
    assert bpm_compatibility(140.0, 70.0) == 1.0
    assert bpm_compatibility(70.0, 140.0) == 1.0


def test_energy_arc_first_half_rewards_buildup():
    up = energy_flow_score(0.4, 0.6, position_ratio=0.2, curve="arc")
    down = energy_flow_score(0.6, 0.4, position_ratio=0.2, curve="arc")
    assert up > down


def test_energy_arc_second_half_rewards_cooldown():
    down = energy_flow_score(0.7, 0.5, position_ratio=0.8, curve="arc")
    up = energy_flow_score(0.5, 0.7, position_ratio=0.8, curve="arc")
    assert down > up


def test_energy_plateau_rewards_stability():
    stable = energy_flow_score(0.5, 0.5, position_ratio=0.5, curve="plateau")
    jump = energy_flow_score(0.2, 0.9, position_ratio=0.5, curve="plateau")
    assert stable == 1.0
    assert jump < stable


def test_energy_unknown_curve_is_neutral():
    assert energy_flow_score(0.5, 0.5, 0.5, curve="zigzag") == 0.5


def test_danceability_similarity():
    assert danceability_similarity(0.7, 0.7) == 1.0
    assert danceability_similarity(0.2, 0.9) == 0.0


def test_year_proximity():
    assert year_proximity_score(None, 2020) == 0.5
    assert year_proximity_score(2020, 2021) == 1.0
    assert year_proximity_score(2000, 2022) == 0.0
    assert year_proximity_score(2010, 2021) == pytest.approx(0.5)


def test_score_transition_missing_features_is_zero():
    a = make_track("a")
    b = make_track("b")
    b.audio_features = None
    assert score_transition(a, b).total_score == 0.0


def test_score_transition_total_is_weighted_sum():
    a = make_track("a", tempo=128, key=0, mode=1, energy=0.5, danceability=0.6, year=2020)
    b = make_track("b", tempo=128, key=0, mode=1, energy=0.6, danceability=0.6, year=2020)
    ts = score_transition(a, b, position_ratio=0.2, energy_curve="arc")
    expected = (
        0.25 * ts.bpm_score
        + 0.25 * ts.key_score
        + 0.20 * ts.energy_score
        + 0.10 * ts.danceability_score
        + 0.20 * ts.year_score
    )
    assert ts.total_score == pytest.approx(expected, abs=1e-3)
    assert ts.bpm_score == 1.0
    assert ts.key_score == 1.0


def test_score_transition_default_key_score_without_camelot():
    a = make_track("a")
    b = make_track("b")
    a.camelot = None
    ts = score_transition(a, b)
    assert ts.key_score == 0.5
