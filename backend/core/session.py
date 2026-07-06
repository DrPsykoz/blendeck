from __future__ import annotations

import hashlib
import hmac
import time

from core.config import get_settings

# Lightweight signed session token for endpoints that browsers call without
# headers (e.g. <audio src>). Issued alongside the Spotify token exchange and
# refresh, carried in a cookie, verified with an HMAC derived from the Spotify
# client secret so no extra secret needs to be provisioned.

SESSION_COOKIE = "blendeck_session"
SESSION_MAX_AGE_S = 30 * 24 * 3600  # matches the refresh-token cookie


def _secret() -> bytes:
    client_secret = get_settings().spotify_client_secret
    return hashlib.sha256(f"blendeck-session:{client_secret}".encode()).digest()


def make_session_token(now: float | None = None) -> str:
    ts = str(int(now if now is not None else time.time()))
    sig = hmac.new(_secret(), ts.encode(), hashlib.sha256).hexdigest()
    return f"{ts}.{sig}"


def verify_session_token(token: str | None, max_age_s: int = SESSION_MAX_AGE_S) -> bool:
    if not token or "." not in token:
        return False
    ts, _, sig = token.partition(".")
    if not ts.isdigit():
        return False
    expected = hmac.new(_secret(), ts.encode(), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(sig, expected):
        return False
    age = time.time() - int(ts)
    return 0 <= age <= max_age_s
