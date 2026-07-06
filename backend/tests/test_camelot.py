from models.track import CamelotKey
from services.camelot import to_camelot, camelot_distance, key_compatibility_score


def key(number: int, letter: str) -> CamelotKey:
    return CamelotKey(number=number, letter=letter)


def test_to_camelot_known_keys():
    assert to_camelot(0, 1).code == "8B"  # C major
    assert to_camelot(9, 0).code == "8A"  # A minor (relative of C major)
    assert to_camelot(11, 1).code == "1B"  # B major
    assert to_camelot(7, 0).code == "6A"  # G minor


def test_to_camelot_invalid_key():
    assert to_camelot(-1, 0) is None
    assert to_camelot(12, 1) is None


def test_distance_same_key_is_zero():
    assert camelot_distance(key(8, "A"), key(8, "A")) == 0


def test_distance_relative_major_minor_is_zero():
    assert camelot_distance(key(8, "A"), key(8, "B")) == 0


def test_distance_adjacent_same_mode():
    assert camelot_distance(key(8, "A"), key(9, "A")) == 1
    assert camelot_distance(key(8, "A"), key(7, "A")) == 1


def test_distance_is_circular():
    assert camelot_distance(key(1, "A"), key(12, "A")) == 1
    assert camelot_distance(key(1, "A"), key(7, "A")) == 6


def test_distance_cross_mode_adds_one():
    assert camelot_distance(key(8, "A"), key(9, "B")) == 2


def test_compatibility_scores():
    assert key_compatibility_score(key(8, "A"), key(8, "A")) == 1.0
    assert key_compatibility_score(key(8, "A"), key(8, "B")) == 1.0
    assert key_compatibility_score(key(8, "A"), key(9, "A")) == 0.9
    assert key_compatibility_score(key(8, "A"), key(10, "A")) == 0.7
    assert key_compatibility_score(key(8, "A"), key(11, "A")) == 0.4
    assert key_compatibility_score(key(1, "A"), key(7, "A")) == 0.1
