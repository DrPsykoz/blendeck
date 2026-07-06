import time

from core.session import make_session_token, verify_session_token


def test_roundtrip():
    assert verify_session_token(make_session_token())


def test_rejects_garbage():
    assert not verify_session_token(None)
    assert not verify_session_token("")
    assert not verify_session_token("not-a-token")
    assert not verify_session_token("12345.deadbeef")


def test_rejects_tampered_timestamp():
    token = make_session_token()
    ts, _, sig = token.partition(".")
    assert not verify_session_token(f"{int(ts) + 1000}.{sig}")


def test_rejects_expired():
    old = make_session_token(now=time.time() - 3600)
    assert verify_session_token(old)
    assert not verify_session_token(old, max_age_s=60)


def test_rejects_future_timestamp():
    ahead = make_session_token(now=time.time() + 3600)
    assert not verify_session_token(ahead)
