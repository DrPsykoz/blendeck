from __future__ import annotations
import io
import logging
import tempfile
import asyncio
from concurrent.futures import ThreadPoolExecutor

import numpy as np

logger = logging.getLogger(__name__)
_executor = ThreadPoolExecutor(max_workers=4)

# Krumhansl-Schmuckler key profiles
_MAJOR_PROFILE = np.array([6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88])
_MINOR_PROFILE = np.array([6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17])

# Pitch class names for logging
_PITCH_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]


def _analyze_sync(audio_bytes: bytes, bpm_hint: float = 0) -> dict:
    """Run librosa analysis synchronously (called in thread pool).

    Returns dict with: tempo, key, mode, energy, danceability, valence,
    loudness, acousticness, instrumentalness, speechiness, liveness.
    """
    import librosa
    import soundfile as sf

    # Load audio from bytes
    with tempfile.NamedTemporaryFile(suffix=".mp3", delete=True) as tmp:
        tmp.write(audio_bytes)
        tmp.flush()
        try:
            y, sr = librosa.load(tmp.name, sr=22050, mono=True, duration=30)
        except Exception as e:
            logger.error(f"Failed to load audio: {e}")
            return {}

    if len(y) < sr * 2:  # less than 2 seconds
        logger.warning("Audio too short for analysis")
        return {}

    # --- BPM ---
    tempo, _beats = librosa.beat.beat_track(y=y, sr=sr)
    if isinstance(tempo, np.ndarray):
        tempo = float(tempo[0])
    else:
        tempo = float(tempo)

    # Use Deezer BPM hint if our estimate seems off
    if bpm_hint > 0:
        # Check if our tempo is close to the hint (or double/half)
        ratios = [tempo / bpm_hint, tempo / (bpm_hint * 2), tempo / (bpm_hint / 2)]
        if not any(0.9 < r < 1.1 for r in ratios):
            # Our tempo is way off, trust the hint
            tempo = bpm_hint

    # --- Key detection (Krumhansl-Schmuckler) ---
    chroma = librosa.feature.chroma_stft(y=y, sr=sr)
    chroma_mean = np.mean(chroma, axis=1)

    best_corr = -2
    best_key = 0
    best_mode = 1  # major

    for shift in range(12):
        shifted_major = np.roll(_MAJOR_PROFILE, shift)
        shifted_minor = np.roll(_MINOR_PROFILE, shift)

        corr_major = np.corrcoef(chroma_mean, shifted_major)[0, 1]
        corr_minor = np.corrcoef(chroma_mean, shifted_minor)[0, 1]

        if corr_major > best_corr:
            best_corr = corr_major
            best_key = shift
            best_mode = 1
        if corr_minor > best_corr:
            best_corr = corr_minor
            best_key = shift
            best_mode = 0

    # --- Energy (RMS-based, normalized to 0-1) ---
    rms = librosa.feature.rms(y=y)[0]
    rms_mean = float(np.mean(rms))
    # Normalize: typical RMS for music is 0.01-0.3
    energy = min(1.0, max(0.0, rms_mean / 0.2))

    # --- Loudness (dB) ---
    loudness = float(20 * np.log10(rms_mean + 1e-10))

    # --- Danceability (beat regularity + onset strength) ---
    onset_env = librosa.onset.onset_strength(y=y, sr=sr)
    # Beat regularity: how consistent are inter-beat intervals
    _, beats = librosa.beat.beat_track(y=y, sr=sr, onset_envelope=onset_env)
    if len(beats) > 2:
        beat_times = librosa.frames_to_time(beats, sr=sr)
        intervals = np.diff(beat_times)
        if len(intervals) > 1:
            regularity = 1.0 - min(1.0, float(np.std(intervals) / (np.mean(intervals) + 1e-10)))
        else:
            regularity = 0.5
    else:
        regularity = 0.3

    # Onset strength contribution
    onset_mean = float(np.mean(onset_env))
    onset_norm = min(1.0, onset_mean / 8.0)

    danceability = 0.6 * regularity + 0.4 * onset_norm
    danceability = min(1.0, max(0.0, danceability))

    # --- Valence approximation (brightness + major/minor) ---
    spectral_centroid = librosa.feature.spectral_centroid(y=y, sr=sr)[0]
    brightness = float(np.mean(spectral_centroid)) / 5000.0  # normalize
    brightness = min(1.0, max(0.0, brightness))
    mode_boost = 0.1 if best_mode == 1 else -0.1
    valence = min(1.0, max(0.0, 0.3 + brightness * 0.5 + mode_boost + energy * 0.2))

    # --- Acousticness (inverse of spectral flatness) ---
    spec_flat = librosa.feature.spectral_flatness(y=y)[0]
    spec_flat_mean = float(np.mean(spec_flat))
    acousticness = min(1.0, max(0.0, 1.0 - spec_flat_mean * 5))

    # --- Speechiness (based on zero crossing rate + spectral rolloff) ---
    zcr = librosa.feature.zero_crossing_rate(y)[0]
    zcr_mean = float(np.mean(zcr))
    speechiness = min(1.0, max(0.0, zcr_mean * 3 - 0.1))

    # --- Instrumentalness (voice detection proxy) ---
    # High spectral centroid variance suggests voice
    centroid_std = float(np.std(spectral_centroid))
    centroid_cv = centroid_std / (float(np.mean(spectral_centroid)) + 1e-10)
    instrumentalness = min(1.0, max(0.0, 1.0 - centroid_cv * 2))

    # --- Liveness (variance in energy over time) ---
    rms_std = float(np.std(rms))
    liveness = min(1.0, max(0.0, rms_std / (rms_mean + 1e-10)))

    result = {
        "tempo": round(tempo, 1),
        "key": best_key,
        "mode": best_mode,
        "energy": round(energy, 3),
        "danceability": round(danceability, 3),
        "valence": round(valence, 3),
        "loudness": round(loudness, 1),
        "acousticness": round(acousticness, 3),
        "instrumentalness": round(instrumentalness, 3),
        "speechiness": round(speechiness, 3),
        "liveness": round(liveness, 3),
    }

    logger.info(
        f"Analysis result: BPM={result['tempo']}, "
        f"Key={_PITCH_NAMES[best_key]}{'m' if best_mode == 0 else ''}, "
        f"Energy={result['energy']}, Dance={result['danceability']}"
    )
    return result


async def analyze_audio(audio_bytes: bytes, bpm_hint: float = 0) -> dict:
    """Analyze audio bytes and return features dict. Runs in thread pool."""
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(_executor, _analyze_sync, audio_bytes, bpm_hint)
