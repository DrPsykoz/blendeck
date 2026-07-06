import asyncio

import pytest

from services import mix_jobs


@pytest.fixture(autouse=True)
def clean_registry():
    mix_jobs._jobs.clear()
    yield
    mix_jobs._jobs.clear()


def test_job_lifecycle_success():
    async def main():
        async def runner(on_progress):
            await on_progress("downloading", 1, 2, "track A")
            await on_progress("downloading", 2, 2, "track B")
            return "mix123"

        job = mix_jobs.start_job("pl1", runner, total_tracks=2, crossfade_s=8)

        events = []
        async for event_type, data in job.follow(0):
            events.append((event_type, data))

        assert job.status == "done"
        assert job.mix_id == "mix123"
        types = [e[0] for e in events]
        assert types[0] == "start"
        assert types[-1] == "complete"
        assert events[0][1]["job_id"] == job.id
        assert events[-1][1]["mix_id"] == "mix123"
        assert types.count("progress") == 2

    asyncio.run(main())


def test_job_failure_emits_error():
    async def main():
        async def runner(on_progress):
            return None

        job = mix_jobs.start_job("pl1", runner, total_tracks=1, crossfade_s=8)
        events = [e async for e in job.follow(0)]
        assert job.status == "error"
        assert events[-1][0] == "error"

    asyncio.run(main())


def test_job_exception_emits_error():
    async def main():
        async def runner(on_progress):
            raise RuntimeError("boom")

        job = mix_jobs.start_job("pl1", runner, total_tracks=1, crossfade_s=8)
        events = [e async for e in job.follow(0)]
        assert job.status == "error"
        assert events[-1][0] == "error"

    asyncio.run(main())


def test_replay_from_index():
    async def main():
        async def runner(on_progress):
            await on_progress("downloading", 1, 1, "t")
            return "m1"

        job = mix_jobs.start_job("pl1", runner, total_tracks=1, crossfade_s=8)
        all_events = [e async for e in job.follow(0)]
        # A late subscriber replaying from index 1 skips the start event
        late_events = [e async for e in job.follow(1)]
        assert len(late_events) == len(all_events) - 1

    asyncio.run(main())


def test_too_many_jobs():
    async def main():
        started = asyncio.Event()
        release = asyncio.Event()

        async def slow_runner(on_progress):
            started.set()
            await release.wait()
            return "m"

        for _ in range(mix_jobs.MAX_CONCURRENT_JOBS):
            mix_jobs.start_job("pl", slow_runner, 1, 8)

        with pytest.raises(mix_jobs.TooManyJobs):
            mix_jobs.start_job("pl", slow_runner, 1, 8)

        release.set()
        await asyncio.sleep(0)

    asyncio.run(main())


def test_get_active_job():
    async def main():
        release = asyncio.Event()

        async def slow_runner(on_progress):
            await release.wait()
            return "m"

        job = mix_jobs.start_job("plX", slow_runner, 1, 8)
        assert mix_jobs.get_active_job("plX") is job
        assert mix_jobs.get_active_job("other") is None
        release.set()
        # Let the runner task finish
        for _ in range(5):
            await asyncio.sleep(0)
        assert mix_jobs.get_active_job("plX") is None

    asyncio.run(main())
