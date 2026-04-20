# Versioning

This project uses semantic versioning (MAJOR.MINOR.PATCH).

## Quick Start

### Option 1: Automatic Versioning (Recommended)

The version number is automatically generated based on the number of commits in the repository. Each time you need to update the version, run:

```bash
./scripts/update-version-from-git.sh
```

This will:

- Count the total commits in the repository
- Generate a version like `1.0.N` where N = commit count
- Update all version references:
    - `VERSION` (root)
    - `backend/main.py`
    - `frontend/package.json`
    - `frontend/package-lock.json`

### Option 2: Manual Versioning

To manually bump the version (MAJOR, MINOR, or PATCH):

```bash
# Bump patch version (1.0.11 → 1.0.12)
./scripts/bump-version.sh patch

# Bump minor version (1.0.11 → 1.1.0)
./scripts/bump-version.sh minor

# Bump major version (1.0.11 → 2.0.0)
./scripts/bump-version.sh major
```

## Automatic Pre-Commit Hook

A git hook is installed at `.git/hooks/prepare-commit-msg` that _can_ automatically bump the patch version before each commit. However, this is disabled by default to avoid unwanted version changes.

To enable it, uncomment the version bump logic in the hook file.

## Version File Locations

- **Root**: `VERSION` - Single source of truth
- **Backend**: `backend/main.py` - Used in FastAPI `FastAPI(version="...")`
- **Frontend**: `frontend/package.json` - npm package version
- **Frontend**: `frontend/package-lock.json` - npm lock file

## CI/CD Integration

For production deployments, run `./scripts/update-version-from-git.sh` before building Docker images to ensure version consistency.

```bash
./scripts/update-version-from-git.sh
docker compose up -d --build
```
