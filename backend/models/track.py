from __future__ import annotations
from pydantic import BaseModel
from typing import Optional


class CamelotKey(BaseModel):
    number: int  # 1-12
    letter: str  # "A" (minor) or "B" (major)

    @property
    def code(self) -> str:
        return f"{self.number}{self.letter}"

    def __str__(self) -> str:
        return self.code


class AudioFeatures(BaseModel):
    tempo: float
    key: int  # 0-11 pitch class, -1 if unknown
    mode: int  # 0=minor, 1=major
    energy: float  # 0.0-1.0
    danceability: float  # 0.0-1.0
    valence: float  # 0.0-1.0
    loudness: float  # dB
    acousticness: float = 0.0
    instrumentalness: float = 0.0
    speechiness: float = 0.0
    liveness: float = 0.0
    duration_ms: int = 0
    time_signature: int = 4


class Track(BaseModel):
    id: str
    name: str
    artists: list[str]
    album: str
    album_image_url: str | None = None
    duration_ms: int
    preview_url: str | None = None
    uri: str
    release_year: int | None = None
    audio_features: AudioFeatures | None = None
    camelot: CamelotKey | None = None


class TransitionScore(BaseModel):
    from_track_id: str
    to_track_id: str
    total_score: float
    bpm_score: float
    key_score: float
    energy_score: float
    danceability_score: float
    year_score: float = 0.0


class PlaylistSummary(BaseModel):
    id: str
    name: str
    description: str | None = None
    image_url: str | None = None
    track_count: int
    owner: str


class SortRequest(BaseModel):
    track_ids: list[str]
    sort_by: str  # "bpm", "key", "energy", "danceability", "valence"
    ascending: bool = True


class GenerateSetRequest(BaseModel):
    track_ids: list[str]
    energy_curve: str = "arc"  # "arc", "linear_up", "linear_down", "plateau"
    bpm_weight: float = 0.25
    key_weight: float = 0.25
    energy_weight: float = 0.20
    danceability_weight: float = 0.10
    year_weight: float = 0.20
    beam_width: int = 5


class GeneratedSet(BaseModel):
    tracks: list[Track]
    transitions: list[TransitionScore]
    total_score: float
    energy_curve: list[float]


class ExportNewPlaylistRequest(BaseModel):
    name: str
    description: str = ""
    track_uris: list[str]
    public: bool = False


class ExportReorderRequest(BaseModel):
    playlist_id: str
    track_uris: list[str]


class ExportFileRequest(BaseModel):
    tracks: list[Track]
    transitions: list[TransitionScore] = []
    format: str = "csv"  # "csv" or "json"
