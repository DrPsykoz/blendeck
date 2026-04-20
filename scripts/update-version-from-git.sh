#!/bin/bash
# Update version based on git commit count
# Usage: ./scripts/update-version-from-git.sh

set -e

# Get commit count as build number
COMMIT_COUNT=$(git rev-list --count HEAD 2>/dev/null || echo "0")

# Base version
MAJOR=1
MINOR=0
PATCH=0

# Use commit count as patch version (or as a build number after patch)
# Format: 1.0.N where N = commit count
VERSION="$MAJOR.$MINOR.$COMMIT_COUNT"
VERSION_FILE="VERSION"

echo "Generating version from git commits..."
echo "Commit count: $COMMIT_COUNT"
echo "Generated version: $VERSION"

# Update VERSION file
echo "$VERSION" > "$VERSION_FILE"

# Update backend/main.py
if [ -f "backend/main.py" ]; then
    sed -i "s/version=\"[^\"]*\"/version=\"$VERSION\"/g" backend/main.py
    echo "✓ Updated backend/main.py"
fi

# Update frontend/package.json
if [ -f "frontend/package.json" ]; then
    sed -i "s/\"version\": \"[^\"]*\"/\"version\": \"$VERSION\"/g" frontend/package.json
    echo "✓ Updated frontend/package.json"
fi

# Update package-lock.json (only first occurrence)
if [ -f "frontend/package-lock.json" ]; then
    sed -i "0,/\"version\": \"[^\"]*\"/s//\"version\": \"$VERSION\"/" frontend/package-lock.json
    echo "✓ Updated frontend/package-lock.json"
fi

echo ""
echo "✅ Version set to $VERSION"
