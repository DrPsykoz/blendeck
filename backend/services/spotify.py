from __future__ import annotations
import asyncio
import logging
import time
from collections.abc import Awaitable, Callable
import httpx

from models.track import Track, AudioFeatures, PlaylistSummary
from services.camelot import to_camelot
from services import features_cache, deezer, audio_analyzer, youtube

SPOTIFY_API = "https://api.spotify.com/v1"

logger = logging.getLogger(__name__)


class CachedValue:
    """Simple TTL cache for a single value."""
    def __init__(self, ttl_seconds: int = 1800):  # 30 minutes default
        self.value = None
        self.ttl_seconds = ttl_seconds
        self.cached_at = 0

    def set(self, value):
        self.value = value
        self.cached_at = time.time()

    def get(self):
        if time.time() - self.cached_at > self.ttl_seconds:
            return None
        return self.value

    def is_valid(self) -> bool:
        return time.time() - self.cached_at <= self.ttl_seconds


# Cache for user profiles by token (token -> user profile)
_user_profile_cache: dict[str, CachedValue] = {}

# Cache for user playlists by token (token -> list of playlists)
_user_playlists_cache: dict[str, CachedValue] = {}


def _headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def get_current_user_profile(token: str) -> dict:
    """Fetch current Spotify user profile (id, email, display_name) with 30min cache."""
    # Check cache
    if token in _user_profile_cache:
        cached = _user_profile_cache[token].get()
        if cached is not None:
            logger.debug(f"Cache hit for user profile")
            return cached

    # Fetch from API
    async with httpx.AsyncClient() as client:
        resp = await client.get(f"{SPOTIFY_API}/me", headers=_headers(token))
        resp.raise_for_status()
        data = resp.json()
    
    profile = {
        "id": data.get("id"),
        "email": data.get("email"),
        "display_name": data.get("display_name"),
    }
    
    # Cache the result
    if token not in _user_profile_cache:
        _user_profile_cache[token] = CachedValue(ttl_seconds=1800)  # 30 minutes
    _user_profile_cache[token].set(profile)
    
    return profile


async def get_user_playlists(token: str) -> list[PlaylistSummary]:
    """Fetch all playlists of the current user with 30min cache."""
    # Check cache
    if token in _user_playlists_cache:
        cached = _user_playlists_cache[token].get()
        if cached is not None:
            logger.debug(f"Cache hit for user playlists")
            return cached

    playlists: list[PlaylistSummary] = []
    url = f"{SPOTIFY_API}/me/playlists?limit=50"

    async with httpx.AsyncClient() as client:
        while url:
            resp = await client.get(url, headers=_headers(token))
            if resp.status_code == 429:
                retry_after = int(resp.headers.get("Retry-After", "2"))
                import asyncio
                await asyncio.sleep(min(retry_after, 10))
                continue
            resp.raise_for_status()
            data = resp.json()

            for item in data.get("items", []):
                if item is None:
                    continue
                images = item.get("images", [])
                playlists.append(
                    PlaylistSummary(
                        id=item["id"],
                        name=item["name"],
                        description=item.get("description"),
                        image_url=images[0]["url"] if images else None,
                        track_count=item["tracks"]["total"],
                        owner=item["owner"]["display_name"] or item["owner"]["id"],
                    )
                )

            url = data.get("next")

    # Cache the result
    if token not in _user_playlists_cache:
        _user_playlists_cache[token] = CachedValue(ttl_seconds=1800)  # 30 minutes
    _user_playlists_cache[token].set(playlists)

    return playlists


async def get_playlist_tracks_basic(token: str, playlist_id: str) -> list[Track]:
    """Fetch all tracks from a playlist (metadata only, no audio features)."""
    tracks: list[Track] = []
    url = f"{SPOTIFY_API}/playlists/{playlist_id}/tracks?limit=100&fields=items(track(id,name,artists(name),album(name,images,release_date),duration_ms,preview_url,uri)),next"

    async with httpx.AsyncClient() as client:
        while url:
            resp = await client.get(url, headers=_headers(token))
            if resp.status_code == 429:
                retry_after = int(resp.headers.get("Retry-After", "2"))
                await asyncio.sleep(min(retry_after, 10))
                continue
            resp.raise_for_status()
            data = resp.json()

            for item in data.get("items", []):
                t = item.get("track")
                if t is None or t.get("id") is None:
                    continue
                images = t.get("album", {}).get("images", [])
                release_date = t.get("album", {}).get("release_date", "")
                release_year = None
                if release_date:
                    try:
                        release_year = int(release_date[:4])
                    except (ValueError, IndexError):
                        pass
                tracks.append(
                    Track(
                        id=t["id"],
                        name=t["name"],
                        artists=[a["name"] for a in t.get("artists", [])],
                        album=t.get("album", {}).get("name", ""),
                        album_image_url=images[0]["url"] if images else None,
                        duration_ms=t.get("duration_ms", 0),
                        preview_url=t.get("preview_url"),
                        uri=t["uri"],
                        release_year=release_year,
                    )
                )

            url = data.get("next")

    # Attach any already-cached features and preview URLs
    for track in tracks:
        # Store track metadata for preview refresh
        artist = track.artists[0] if track.artists else ""
        features_cache.set_track_meta(track.id, track.name, artist)

        af = features_cache.get_cached(track.id)
        if af:
            track.audio_features = af
            track.camelot = to_camelot(af.key, af.mode)
        if not track.preview_url:
            preview = features_cache.get_preview_url(track.id)
            if preview:
                track.preview_url = preview

    features_cache.save()
    return tracks


# Callback type: (current_idx, total, track_id, track_name, artist, status, features_dict|None) -> None
ProgressCallback = Callable[
    [int, int, str, str, str, str, dict | None], Awaitable[None]
]


async def analyze_tracks_with_progress(
    token: str,
    tracks: list[Track],
    on_progress: ProgressCallback | None = None,
) -> list[Track]:
    """Fetch audio features for tracks with progress callbacks.

    Tries Spotify API first, falls back to Deezer + librosa.
    Calls on_progress for each track analyzed.
    """
    all_ids = [t.id for t in tracks]
    need_ids = features_cache.uncached_ids(all_ids)
    total = len(need_ids)
    logger.info(
        f"Need audio features for {total}/{len(tracks)} tracks "
        f"({len(tracks) - total} already cached)"
    )

    if not need_ids:
        # All cached, just attach and return
        _attach_features(tracks)
        return tracks

    track_info = {t.id: t for t in tracks if t.id in set(need_ids)}

    # Fallback 1: Try Spotify audio-features API
    async with httpx.AsyncClient() as client:
        spotify_ok = await _try_spotify_audio_features(client, token, need_ids)

    # Check what's still missing after Spotify attempt
    still_need = features_cache.uncached_ids(need_ids)

    if still_need:
        if not spotify_ok:
            logger.info("Spotify audio-features unavailable, falling back to Deezer + librosa")
        # Fallback 2: Deezer BPM + preview analysis with progress
        await _try_deezer_analysis_with_progress(
            still_need, track_info, total, on_progress
        )
    else:
        # Spotify worked for all - report all as done
        if on_progress:
            for idx, tid in enumerate(need_ids):
                t = track_info.get(tid)
                if t:
                    await on_progress(
                        idx + 1, total, tid, t.name,
                        t.artists[0] if t.artists else "",
                        "done", None,
                    )

    features_cache.save()
    _attach_features(tracks)
    return tracks


def _attach_features(tracks: list[Track]) -> None:
    """Attach cached audio features, camelot keys, and preview URLs to tracks."""
    attached = 0
    for track in tracks:
        af = features_cache.get_cached(track.id)
        if af:
            track.audio_features = af
            track.camelot = to_camelot(af.key, af.mode)
            attached += 1
        # Attach Deezer preview URL if Spotify one is missing
        if not track.preview_url:
            preview = features_cache.get_preview_url(track.id)
            if preview:
                track.preview_url = preview
    logger.info(f"Attached audio features to {attached}/{len(tracks)} tracks")


async def get_playlist_tracks(token: str, playlist_id: str) -> list[Track]:
    """Fetch all tracks from a playlist with their audio features (no progress)."""
    tracks = await get_playlist_tracks_basic(token, playlist_id)
    return await analyze_tracks_with_progress(token, tracks, on_progress=None)



async def _try_spotify_audio_features(
    client: httpx.AsyncClient, token: str, track_ids: list[str]
) -> bool:
    """Try Spotify audio-features API. Returns True if API is accessible."""
    api_accessible = True
    for i in range(0, len(track_ids), 100):
        batch = track_ids[i : i + 100]
        ids_param = ",".join(batch)
        try:
            resp = await client.get(
                f"{SPOTIFY_API}/audio-features?ids={ids_param}",
                headers=_headers(token),
                timeout=30.0,
            )
            if resp.status_code == 403:
                logger.warning("Spotify audio-features returned 403 (deprecated)")
                return False
            if resp.status_code == 429:
                retry_after = int(resp.headers.get("Retry-After", "2"))
                logger.warning(f"Rate limited, waiting {retry_after}s")
                await asyncio.sleep(min(retry_after, 10))
                resp = await client.get(
                    f"{SPOTIFY_API}/audio-features?ids={ids_param}",
                    headers=_headers(token),
                    timeout=30.0,
                )
            if resp.status_code != 200:
                logger.error(
                    f"Spotify audio-features batch {i//100+1}: "
                    f"HTTP {resp.status_code}"
                )
                continue

            features_data = resp.json().get("audio_features", [])
            count = 0
            for feat in features_data:
                if feat is None:
                    continue
                af = AudioFeatures(
                    tempo=feat.get("tempo", 0),
                    key=feat.get("key", -1),
                    mode=feat.get("mode", 0),
                    energy=feat.get("energy", 0),
                    danceability=feat.get("danceability", 0),
                    valence=feat.get("valence", 0),
                    loudness=feat.get("loudness", -60),
                    acousticness=feat.get("acousticness", 0),
                    instrumentalness=feat.get("instrumentalness", 0),
                    speechiness=feat.get("speechiness", 0),
                    liveness=feat.get("liveness", 0),
                    duration_ms=feat.get("duration_ms", 0),
                    time_signature=feat.get("time_signature", 4),
                )
                features_cache.set_cached(feat["id"], af)
                count += 1
            logger.info(
                f"Spotify batch {i//100+1}: {count}/{len(batch)} features"
            )
        except Exception as e:
            logger.error(f"Spotify audio-features exception: {e}")
    return api_accessible


async def _try_deezer_analysis_with_progress(
    track_ids: list[str],
    track_info: dict[str, Track],
    total: int,
    on_progress: ProgressCallback | None = None,
) -> None:
    """Fallback: Deezer BPM + preview + librosa, with per-track progress."""
    analyzed = 0
    offset = total - len(track_ids)  # tracks already handled by Spotify

    for idx, tid in enumerate(track_ids):
        t = track_info.get(tid)
        if not t:
            continue
        artist = t.artists[0] if t.artists else ""

        if on_progress:
            await on_progress(
                offset + idx + 1, total, tid, t.name, artist,
                "analyzing", None,
            )

        ok = await _analyze_single_track(tid, t)

        if on_progress:
            af = features_cache.get_cached(tid)
            feat_dict = None
            if af:
                feat_dict = {
                    "tempo": af.tempo, "energy": af.energy,
                    "key": af.key, "mode": af.mode,
                    "danceability": af.danceability,
                }
            status = "done" if ok else "failed"
            await on_progress(
                offset + idx + 1, total, tid, t.name, artist,
                status, feat_dict,
            )

        if ok:
            analyzed += 1

    logger.info(f"Deezer+librosa: analyzed {analyzed}/{len(track_ids)} tracks")


async def _analyze_single_track(track_id: str, track: Track) -> bool:
    """Analyze a single track via Deezer search + preview + librosa, with YouTube fallback."""
    artist = track.artists[0] if track.artists else ""
    title = track.name

    # Search Deezer for BPM and preview URL
    deezer_info = await deezer.search_track(artist, title)
    bpm_hint = 0
    preview_url = None

    if deezer_info:
        bpm_hint = deezer_info.get("bpm", 0)
        preview_url = deezer_info.get("preview_url")

        # Always save the Deezer preview URL if available
        if preview_url:
            features_cache.set_preview_url(track_id, preview_url)

    # Try Deezer preview first
    audio_bytes = None
    if preview_url:
        audio_bytes = await deezer.download_preview(preview_url)

    # Fallback to YouTube if no Deezer preview
    source = "deezer"
    if not audio_bytes:
        logger.info(f"Deezer preview unavailable, trying YouTube for: {artist} - {title}")
        audio_bytes = await youtube.download_audio(artist, title)
        source = "youtube"

    if not audio_bytes:
        # Last resort: if Deezer gave us at least a BPM, use that
        if bpm_hint > 0:
            af = AudioFeatures(
                tempo=bpm_hint,
                key=-1,
                mode=0,
                energy=0.5,
                danceability=0.5,
                valence=0.5,
                loudness=-10,
                acousticness=0.5,
                instrumentalness=0.5,
                speechiness=0.1,
                liveness=0.2,
                duration_ms=track.duration_ms,
                time_signature=4,
            )
            features_cache.set_cached(track_id, af)
            return True
        logger.debug(f"No audio source found for: {artist} - {title}")
        return False

    try:
        analysis = await audio_analyzer.analyze_audio(audio_bytes, bpm_hint)
        if not analysis:
            return False

        af = AudioFeatures(
            tempo=analysis.get("tempo", bpm_hint or 120),
            key=analysis.get("key", -1),
            mode=analysis.get("mode", 0),
            energy=analysis.get("energy", 0.5),
            danceability=analysis.get("danceability", 0.5),
            valence=analysis.get("valence", 0.5),
            loudness=analysis.get("loudness", -10),
            acousticness=analysis.get("acousticness", 0.5),
            instrumentalness=analysis.get("instrumentalness", 0.5),
            speechiness=analysis.get("speechiness", 0.1),
            liveness=analysis.get("liveness", 0.2),
            duration_ms=track.duration_ms,
            time_signature=analysis.get("time_signature", 4),
        )
        features_cache.set_cached(track_id, af)
        logger.info(f"Analyzed ({source}): {artist} - {title} → BPM={af.tempo}, E={af.energy}")
        return True
    except Exception as e:
        logger.error(f"Analysis failed for {artist} - {title}: {e}")
        return False


async def create_playlist(
    token: str, name: str, description: str = "", public: bool = False
) -> str:
    """Create a new playlist and return its ID."""
    async with httpx.AsyncClient() as client:
        # Get current user ID from cache or API
        user_profile = await get_current_user_profile(token)
        user_id = user_profile["id"]

        resp = await client.post(
            f"{SPOTIFY_API}/users/{user_id}/playlists",
            headers=_headers(token),
            json={"name": name, "description": description, "public": public},
        )
        resp.raise_for_status()
        return resp.json()["id"]


async def add_tracks_to_playlist(
    token: str, playlist_id: str, uris: list[str]
) -> None:
    """Add tracks to a playlist in batches of 100."""
    async with httpx.AsyncClient() as client:
        for i in range(0, len(uris), 100):
            batch = uris[i : i + 100]
            resp = await client.post(
                f"{SPOTIFY_API}/playlists/{playlist_id}/tracks",
                headers=_headers(token),
                json={"uris": batch},
            )
            if resp.status_code == 429:
                import asyncio
                retry_after = int(resp.headers.get("Retry-After", "2"))
                await asyncio.sleep(min(retry_after, 10))
                resp = await client.post(
                    f"{SPOTIFY_API}/playlists/{playlist_id}/tracks",
                    headers=_headers(token),
                    json={"uris": batch},
                )
            resp.raise_for_status()


async def replace_playlist_tracks(
    token: str, playlist_id: str, uris: list[str]
) -> None:
    """Replace all tracks in a playlist (reorder)."""
    async with httpx.AsyncClient() as client:
        # First batch uses PUT to replace, subsequent use POST to add
        first_batch = uris[:100]
        resp = await client.put(
            f"{SPOTIFY_API}/playlists/{playlist_id}/tracks",
            headers=_headers(token),
            json={"uris": first_batch},
        )
        resp.raise_for_status()

        for i in range(100, len(uris), 100):
            batch = uris[i : i + 100]
            resp = await client.post(
                f"{SPOTIFY_API}/playlists/{playlist_id}/tracks",
                headers=_headers(token),
                json={"uris": batch},
            )
            if resp.status_code == 429:
                import asyncio
                retry_after = int(resp.headers.get("Retry-After", "2"))
                await asyncio.sleep(min(retry_after, 10))
                resp = await client.post(
                    f"{SPOTIFY_API}/playlists/{playlist_id}/tracks",
                    headers=_headers(token),
                    json={"uris": batch},
                )
            resp.raise_for_status()
