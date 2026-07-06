import os
import sys
import tempfile
from pathlib import Path

# Point the cache layout at a throwaway dir BEFORE importing any backend module,
# otherwise core.paths creates /app/cache at import time.
os.environ.setdefault("CACHE_DIR", tempfile.mkdtemp(prefix="blendeck-test-cache-"))

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
