from __future__ import annotations

import logging
import os
import re

logger = logging.getLogger(__name__)


def int_env(name: str, default: int, min_value: int = 1, max_value: int = 8) -> int:
    """Read and clamp an integer env var, with safe fallback."""
    raw = os.getenv(name)
    if raw is None:
        return default
    try:
        value = int(raw)
    except ValueError:
        logger.warning(f"Env: invalid value for {name}='{raw}', using {default}")
        return default
    return max(min_value, min(max_value, value))


def bitrate_env(name: str, default: str = "320k") -> str:
    """Read a safe audio bitrate value like 192k/256k/320k."""
    raw = (os.getenv(name) or default).strip().lower()
    if re.fullmatch(r"[1-9][0-9]{1,3}k", raw):
        return raw
    logger.warning(f"Env: invalid bitrate for {name}='{raw}', using {default}")
    return default


def bool_env(name: str, default: bool) -> bool:
    """Read a bool env var from 1/0, true/false, yes/no, on/off."""
    raw = os.getenv(name)
    if raw is None:
        return default
    normalized = raw.strip().lower()
    if normalized in {"1", "true", "yes", "on"}:
        return True
    if normalized in {"0", "false", "no", "off"}:
        return False
    logger.warning(f"Env: invalid bool for {name}='{raw}', using {default}")
    return default
