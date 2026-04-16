from __future__ import annotations
from models.track import CamelotKey

# Mapping: (spotify_key, mode) -> CamelotKey
# spotify_key: 0=C, 1=C#, 2=D, 3=D#, 4=E, 5=F, 6=F#, 7=G, 8=G#, 9=A, 10=Bb, 11=B
# mode: 0=minor, 1=major
_CAMELOT_MAP: dict[tuple[int, int], tuple[int, str]] = {
    # Major keys (B = major on Camelot)
    (0, 1): (8, "B"),   # C major
    (1, 1): (3, "B"),   # C# major
    (2, 1): (10, "B"),  # D major
    (3, 1): (5, "B"),   # D# / Eb major
    (4, 1): (12, "B"),  # E major
    (5, 1): (7, "B"),   # F major
    (6, 1): (2, "B"),   # F# major
    (7, 1): (9, "B"),   # G major
    (8, 1): (4, "B"),   # G# / Ab major
    (9, 1): (11, "B"),  # A major
    (10, 1): (6, "B"),  # Bb major
    (11, 1): (1, "B"),  # B major
    # Minor keys (A = minor on Camelot)
    (0, 0): (5, "A"),   # C minor
    (1, 0): (12, "A"),  # C# minor
    (2, 0): (7, "A"),   # D minor
    (3, 0): (2, "A"),   # D# / Eb minor
    (4, 0): (9, "A"),   # E minor
    (5, 0): (4, "A"),   # F minor
    (6, 0): (11, "A"),  # F# minor
    (7, 0): (6, "A"),   # G minor
    (8, 0): (1, "A"),   # G# / Ab minor
    (9, 0): (8, "A"),   # A minor
    (10, 0): (3, "A"),  # Bb minor
    (11, 0): (10, "A"), # B minor
}


def to_camelot(key: int, mode: int) -> CamelotKey | None:
    """Convert Spotify key (0-11) + mode (0/1) to Camelot notation."""
    if key < 0 or key > 11:
        return None
    result = _CAMELOT_MAP.get((key, mode))
    if result is None:
        return None
    return CamelotKey(number=result[0], letter=result[1])


def camelot_distance(a: CamelotKey, b: CamelotKey) -> int:
    """Minimum steps on the Camelot wheel between two keys.
    Same number + same letter = 0
    Adjacent numbers + same letter = 1
    Same number + different letter (relative major/minor) = 1
    Otherwise, compute circular distance on the 12-position wheel.
    Returns the raw step count (0-6).
    """
    if a.letter == b.letter:
        # Same mode: circular distance on the 12-position wheel
        diff = abs(a.number - b.number)
        return min(diff, 12 - diff)
    else:
        # Different mode (A↔B): relative major/minor at same number = 0 step penalty
        # We treat switching mode as equivalent to 0 extra steps on the same number
        diff = abs(a.number - b.number)
        circular = min(diff, 12 - diff)
        # Relative major/minor (same number) is a 0-cost switch
        # For different numbers across modes, add 1 for the mode switch
        if circular == 0:
            return 0  # Relative major/minor — perfect compatibility
        return circular + 1


def key_compatibility_score(a: CamelotKey, b: CamelotKey) -> float:
    """Score from 0.0 to 1.0 for harmonic compatibility between two Camelot keys.
    0 steps = 1.0 (perfect)
    1 step  = 0.9 (adjacent / relative)
    2 steps = 0.7
    3 steps = 0.4
    4+ steps = 0.1
    """
    dist = camelot_distance(a, b)
    scores = {0: 1.0, 1: 0.9, 2: 0.7, 3: 0.4}
    return scores.get(dist, 0.1)
