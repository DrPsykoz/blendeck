from __future__ import annotations
import logging
import tempfile
import asyncio
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

logger = logging.getLogger(__name__)
_executor = ThreadPoolExecutor(max_workers=2)


def _download_sync(artist: str, title: str, duration_s: int = 30) -> bytes | None:
    """Search YouTube and download a short audio snippet. Returns MP3 bytes or None."""
    import yt_dlp

    query = f"{artist} {title} audio"
    tmp_dir = tempfile.mkdtemp()
    output_path = Path(tmp_dir) / "audio.mp3"

    ydl_opts = {
        "format": "bestaudio/best",
        "default_search": "ytsearch1",
        "noplaylist": True,
        "quiet": True,
        "no_warnings": True,
        "extractaudio": True,
        "outtmpl": str(Path(tmp_dir) / "audio.%(ext)s"),
        "postprocessors": [
            {
                "key": "FFmpegExtractAudio",
                "preferredcodec": "mp3",
                "preferredquality": "128",
            }
        ],
        # Download only the first ~30 seconds worth of data
        "download_ranges": lambda info, ydl: [{"start_time": 30, "end_time": 30 + duration_s}],
        "force_keyframes_at_cuts": True,
        "socket_timeout": 20,
        "retries": 2,
    }

    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(query, download=True)
            if info is None:
                logger.warning(f"YouTube: no results for '{query}'")
                return None
    except Exception as e:
        logger.error(f"YouTube download error for '{artist} - {title}': {e}")
        # Retry without download_ranges (some extractors don't support it)
        try:
            ydl_opts.pop("download_ranges", None)
            ydl_opts.pop("force_keyframes_at_cuts", None)
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                info = ydl.extract_info(query, download=True)
                if info is None:
                    return None
        except Exception as e2:
            logger.error(f"YouTube retry failed for '{artist} - {title}': {e2}")
            return None

    # Find the output mp3 file
    if output_path.exists():
        data = output_path.read_bytes()
    else:
        # yt-dlp may name it differently, search for any mp3
        mp3_files = list(Path(tmp_dir).glob("*.mp3"))
        if not mp3_files:
            logger.warning(f"YouTube: no MP3 output for '{artist} - {title}'")
            return None
        data = mp3_files[0].read_bytes()

    # Clean up
    import shutil
    shutil.rmtree(tmp_dir, ignore_errors=True)

    if len(data) < 1000:
        logger.warning(f"YouTube: audio too small ({len(data)} bytes) for '{artist} - {title}'")
        return None

    logger.info(f"YouTube: downloaded {len(data) // 1024}KB for '{artist} - {title}'")
    return data


async def download_audio(artist: str, title: str, duration_s: int = 30) -> bytes | None:
    """Search YouTube and download audio snippet asynchronously."""
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(_executor, _download_sync, artist, title, duration_s)
