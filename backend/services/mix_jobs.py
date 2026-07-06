from __future__ import annotations

import asyncio
import logging
import time
import uuid
from dataclasses import dataclass, field
from typing import AsyncIterator, Awaitable, Callable

logger = logging.getLogger(__name__)

# In-memory mix job registry (single-worker assumption, like the rest of the
# app). A job owns the generate_mix task and buffers every progress event, so
# any number of SSE clients can attach, detach and replay from the start —
# closing the browser tab no longer loses a 20-minute generation.

MAX_CONCURRENT_JOBS = 2
_JOB_RETENTION_S = 3600


class TooManyJobs(Exception):
    pass


@dataclass
class MixJob:
    id: str
    playlist_id: str
    created_at: float = field(default_factory=time.time)
    status: str = "running"  # running | done | error
    mix_id: str | None = None
    error: str | None = None
    events: list[tuple[str, dict]] = field(default_factory=list)
    _wakeup: asyncio.Event = field(default_factory=asyncio.Event)

    def push(self, event_type: str, data: dict) -> None:
        self.events.append((event_type, data))
        self._wakeup.set()
        self._wakeup = asyncio.Event()

    @property
    def finished(self) -> bool:
        return self.status in ("done", "error")

    async def follow(self, from_index: int = 0) -> AsyncIterator[tuple[str, dict]]:
        """Yield buffered events from from_index, then live ones until the job ends."""
        i = from_index
        while True:
            while i < len(self.events):
                yield self.events[i]
                i += 1
            if self.finished:
                return
            wakeup = self._wakeup
            try:
                await asyncio.wait_for(wakeup.wait(), timeout=2.0)
            except asyncio.TimeoutError:
                pass  # re-check finished flag even without new events


_jobs: dict[str, MixJob] = {}


def _prune() -> None:
    cutoff = time.time() - _JOB_RETENTION_S
    for job_id in [j for j, job in _jobs.items() if job.finished and job.created_at < cutoff]:
        _jobs.pop(job_id, None)


def get_job(job_id: str) -> MixJob | None:
    return _jobs.get(job_id)


def get_active_job(playlist_id: str) -> MixJob | None:
    for job in _jobs.values():
        if job.playlist_id == playlist_id and not job.finished:
            return job
    return None


def running_count() -> int:
    return sum(1 for job in _jobs.values() if not job.finished)


def start_job(
    playlist_id: str,
    runner: Callable[[Callable[[str, int, int, str], Awaitable[None]]], Awaitable[str | None]],
    total_tracks: int,
    crossfade_s: int,
) -> MixJob:
    """Register a job and launch the mix generation task in the background.

    runner receives the on_progress callback and returns the mix_id (or None).
    Raises TooManyJobs above MAX_CONCURRENT_JOBS running jobs.
    """
    _prune()
    if running_count() >= MAX_CONCURRENT_JOBS:
        raise TooManyJobs()

    job = MixJob(id=uuid.uuid4().hex[:12], playlist_id=playlist_id)
    _jobs[job.id] = job
    job.push("start", {"total": total_tracks, "crossfade": crossfade_s, "job_id": job.id})

    async def on_progress(status: str, current: int, total: int, detail: str) -> None:
        job.push("progress", {
            "status": status, "current": current, "total": total, "detail": detail,
        })

    async def _run() -> None:
        try:
            mix_id = await runner(on_progress)
            if mix_id:
                job.mix_id = mix_id
                job.status = "done"
                job.push("complete", {"mix_id": mix_id})
            else:
                job.status = "error"
                job.error = "Échec de la génération du mix"
                job.push("error", {"message": job.error})
        except Exception as e:
            logger.exception("Mix job %s failed", job.id)
            job.status = "error"
            job.error = str(e)
            job.push("error", {"message": "Échec de la génération du mix"})

    asyncio.create_task(_run())
    return job
