from services.set_generator import generate_set
from tests.test_transition import make_track


def test_empty_playlist():
    result = generate_set([])
    assert result.tracks == []
    assert result.transitions == []
    assert result.total_score == 0.0


def test_single_track():
    track = make_track("solo", energy=0.8)
    result = generate_set([track])
    assert [t.id for t in result.tracks] == ["solo"]
    assert result.transitions == []
    assert result.energy_curve == [0.8]


def test_set_is_permutation_of_input():
    tracks = [make_track(str(i), tempo=120 + i, energy=i / 10) for i in range(6)]
    result = generate_set(tracks, beam_width=3)
    assert sorted(t.id for t in result.tracks) == sorted(t.id for t in tracks)
    assert len(result.transitions) == len(tracks) - 1
    assert len(result.energy_curve) == len(tracks)


def test_arc_opens_with_lowest_energy():
    tracks = [make_track(str(i), energy=e) for i, e in enumerate([0.9, 0.2, 0.5, 0.7])]
    result = generate_set(tracks, energy_curve="arc")
    assert result.tracks[0].audio_features.energy == 0.2


def test_linear_down_opens_with_highest_energy():
    tracks = [make_track(str(i), energy=e) for i, e in enumerate([0.9, 0.2, 0.5, 0.7])]
    result = generate_set(tracks, energy_curve="linear_down")
    assert result.tracks[0].audio_features.energy == 0.9


def test_transitions_link_consecutive_tracks():
    tracks = [make_track(str(i), tempo=124, energy=0.5) for i in range(4)]
    result = generate_set(tracks)
    for i, ts in enumerate(result.transitions):
        assert ts.from_track_id == result.tracks[i].id
        assert ts.to_track_id == result.tracks[i + 1].id
