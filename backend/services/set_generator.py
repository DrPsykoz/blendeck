from __future__ import annotations
from models.track import Track, TransitionScore, GeneratedSet
from services.transition import score_transition


def generate_set(
    tracks: list[Track],
    energy_curve: str = "arc",
    bpm_weight: float = 0.25,
    key_weight: float = 0.25,
    energy_weight: float = 0.20,
    danceability_weight: float = 0.10,
    year_weight: float = 0.20,
    beam_width: int = 5,
) -> GeneratedSet:
    """Generate an optimal DJ set using greedy beam search.

    1. Sort tracks by energy to pick opening track
    2. At each step, evaluate all remaining candidates
    3. Keep top beam_width paths and explore from each
    4. Return the best complete path
    """
    if not tracks:
        return GeneratedSet(tracks=[], transitions=[], total_score=0.0, energy_curve=[])

    if len(tracks) == 1:
        ec = [tracks[0].audio_features.energy] if tracks[0].audio_features else [0.5]
        return GeneratedSet(tracks=tracks, transitions=[], total_score=1.0, energy_curve=ec)

    n = len(tracks)

    # Pick opening track: lowest energy for "arc" and "linear_up",
    # highest energy for "linear_down", median for "plateau"
    sorted_by_energy = sorted(
        tracks,
        key=lambda t: t.audio_features.energy if t.audio_features else 0.5,
    )

    if energy_curve in ("arc", "linear_up"):
        opening = sorted_by_energy[0]
    elif energy_curve == "linear_down":
        opening = sorted_by_energy[-1]
    else:  # plateau
        opening = sorted_by_energy[n // 2]

    # Beam search
    # Each beam is (path: list[Track], used_ids: set[str], total_score: float)
    beams: list[tuple[list[Track], set[str], float]] = [
        ([opening], {opening.id}, 0.0)
    ]

    for step in range(1, n):
        position_ratio = step / max(n - 1, 1)
        new_beams: list[tuple[list[Track], set[str], float]] = []

        for path, used_ids, total_score in beams:
            current_track = path[-1]
            remaining = [t for t in tracks if t.id not in used_ids]

            if not remaining:
                new_beams.append((path, used_ids, total_score))
                continue

            # Score all remaining candidates
            candidates: list[tuple[Track, float]] = []
            for candidate in remaining:
                ts = score_transition(
                    current_track,
                    candidate,
                    position_ratio=position_ratio,
                    energy_curve=energy_curve,
                    bpm_weight=bpm_weight,
                    key_weight=key_weight,
                    energy_weight=energy_weight,
                    dance_weight=danceability_weight,
                    year_weight=year_weight,
                )
                candidates.append((candidate, ts.total_score))

            # Keep top beam_width candidates
            candidates.sort(key=lambda x: x[1], reverse=True)
            for candidate, sc in candidates[:beam_width]:
                new_path = path + [candidate]
                new_used = used_ids | {candidate.id}
                new_beams.append((new_path, new_used, total_score + sc))

        # Prune beams to beam_width best
        new_beams.sort(key=lambda x: x[2], reverse=True)
        beams = new_beams[:beam_width]

    # Pick the best beam
    best_path, _, best_total = beams[0]

    # Compute final transitions for the best path
    transitions: list[TransitionScore] = []
    for i in range(len(best_path) - 1):
        position_ratio = (i + 1) / max(len(best_path) - 1, 1)
        ts = score_transition(
            best_path[i],
            best_path[i + 1],
            position_ratio=position_ratio,
            energy_curve=energy_curve,
            bpm_weight=bpm_weight,
            key_weight=key_weight,
            energy_weight=energy_weight,
            dance_weight=danceability_weight,
            year_weight=year_weight,
        )
        transitions.append(ts)

    energy_values = [
        t.audio_features.energy if t.audio_features else 0.5 for t in best_path
    ]

    return GeneratedSet(
        tracks=best_path,
        transitions=transitions,
        total_score=round(best_total, 4),
        energy_curve=energy_values,
    )
