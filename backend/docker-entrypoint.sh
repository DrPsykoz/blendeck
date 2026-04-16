#!/bin/bash
set -e

# Fix ownership of the mounted cache volume (may have been created as root)
# This runs as root before switching to appuser via gosu or exec
if [ "$(id -u)" = "0" ]; then
    chown -R appuser:appuser /app/cache 2>/dev/null || true
    exec gosu appuser "$@"
fi

exec "$@"
