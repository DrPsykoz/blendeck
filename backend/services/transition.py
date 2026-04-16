from __future__ import annotations
from models.track import Track, TransitionScore
from services.camelot import key_compatibility_score


def bpm_compatibility(bpm_a: float, bpm_b: float) -> float:
    """Score BPM compatibility (0.0-1.0).
    Perfect match = 1.0, linearly drops to 0 at ±15 BPM.
    Also considers double/half-time relationships.
    """
    diff = abs(bpm_a - bpm_b)

    # Check double/half-time
    double_diff = abs(bpm_a - bpm_b * 2)
    half_diff = abs(bpm_a - bpm_b / 2)
    diff = min(diff, double_diff, half_diff)

    if diff <= 3:
        return 1.0
    if diff >= 15:
        return 0.0
    return 1.0 - (diff - 3) / 12.0


def energy_flow_score(
    energy_a: float,
    energy_b: float,
    position_ratio: float,
    curve: str = "arc",
) -> float:
    """Score energy flow based on position in the set and target curve.

    position_ratio: 0.0 (start) to 1.0 (end)
    curve: 'arc' (build-up then cool-down), 'linear_up', 'linear_down', 'plateau'
    """
    diff = energy_b - energy_a

    if curve == "arc":
        # First half: prefer increasing energy, second half: prefer decreasing
        if position_ratio < 0.5:
            # Build-up: reward positive energy diff
            if diff >= 0:
                return min(1.0, 0.7 + diff)
            else:
                return max(0.2, 0.7 + diff * 2)
        else:
            # Cool-down: reward negative or stable energy diff
            if diff <= 0:
                return min(1.0, 0.7 - diff)
            else:
                return max(0.2, 0.7 - diff * 2)

    elif curve == "linear_up":
        if diff >= 0:
            return min(1.0, 0.7 + diff)
        return max(0.1, 0.5 + diff)

    elif curve == "linear_down":
        if diff <= 0:
            return min(1.0, 0.7 - diff)
        return max(0.1, 0.5 - diff)

    elif curve == "plateau":
        # Prefer minimal energy changes
        return max(0.2, 1.0 - abs(diff) * 3)

    return 0.5


def danceability_similarity(dance_a: float, dance_b: float) -> float:
    """Score similarity in danceability (0.0-1.0)."""
    return max(0.0, 1.0 - abs(dance_a - dance_b) * 3)


def year_proximity_score(year_a: int | None, year_b: int | None) -> float:
    """Score year proximity (0.0-1.0).
    Same year = 1.0, linearly drops to 0 at ±20 years apart.
    Unknown years get a neutral 0.5.
    """
    if year_a is None or year_b is None:
        return 0.5
    diff = abs(year_a - year_b)
    if diff <= 2:
        return 1.0
    if diff >= 20:
        return 0.0
    return 1.0 - (diff - 2) / 18.0


def score_transition(
    track_a: Track,
    track_b: Track,
    position_ratio: float = 0.5,
    energy_curve: str = "arc",
    bpm_weight: float = 0.25,
    key_weight: float = 0.25,
    energy_weight: float = 0.20,
    dance_weight: float = 0.10,
    year_weight: float = 0.20,
) -> TransitionScore:
    """Compute a multi-factor transition score between two tracks."""
    af_a = track_a.audio_features
    af_b = track_b.audio_features

    if af_a is None or af_b is None:
        return TransitionScore(
            from_track_id=track_a.id,
            to_track_id=track_b.id,
            total_score=0.0,
            bpm_score=0.0,
            key_score=0.0,
            energy_score=0.0,
            danceability_score=0.0,
            year_score=0.0,
        )

    bpm_sc = bpm_compatibility(af_a.tempo, af_b.tempo)

    key_sc = 0.5  # default if camelot unknown
    if track_a.camelot and track_b.camelot:
        key_sc = key_compatibility_score(track_a.camelot, track_b.camelot)

    energy_sc = energy_flow_score(
        af_a.energy, af_b.energy, position_ratio, energy_curve
    )
    dance_sc = danceability_similarity(af_a.danceability, af_b.danceability)
    year_sc = year_proximity_score(track_a.release_year, track_b.release_year)

    total = (
        bpm_weight * bpm_sc
        + key_weight * key_sc
        + energy_weight * energy_sc
        + dance_weight * dance_sc
        + year_weight * year_sc
    )

    return TransitionScore(
        from_track_id=track_a.id,
        to_track_id=track_b.id,
        total_score=round(total, 4),
        bpm_score=round(bpm_sc, 4),
        key_score=round(key_sc, 4),
        energy_score=round(energy_sc, 4),
        danceability_score=round(dance_sc, 4),
        year_score=round(year_sc, 4),
    )
