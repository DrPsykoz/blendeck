#!/bin/bash
# Bump version (MAJOR.MINOR.PATCH) and update version in backend/main.py and frontend/package.json
# Usage: ./scripts/bump-version.sh [major|minor|patch] (default: patch)

set -e

BUMP_TYPE="${1:-patch}"
VERSION_FILE="VERSION"

if [ ! -f "$VERSION_FILE" ]; then
    echo "Error: VERSION file not found at root"
    exit 1
fi

CURRENT_VERSION=$(cat "$VERSION_FILE")
echo "Current version: $CURRENT_VERSION"

# Parse version parts
IFS='.' read -r MAJOR MINOR PATCH <<< "$CURRENT_VERSION"

case "$BUMP_TYPE" in
    major)
        MAJOR=$((MAJOR + 1))
        MINOR=0
        PATCH=0
        ;;
    minor)
        MINOR=$((MINOR + 1))
        PATCH=0
        ;;
    patch)
        PATCH=$((PATCH + 1))
        ;;
    *)
        echo "Error: Invalid bump type '$BUMP_TYPE'. Use 'major', 'minor', or 'patch'"
        exit 1
        ;;
esac

NEW_VERSION="$MAJOR.$MINOR.$PATCH"
echo "New version: $NEW_VERSION"

# Update VERSION file
echo "$NEW_VERSION" > "$VERSION_FILE"

# Update backend/main.py
if [ -f "backend/main.py" ]; then
    sed -i "s/version=\"[^\"]*\"/version=\"$NEW_VERSION\"/g" backend/main.py
    echo "✓ Updated backend/main.py"
fi

# Update frontend/package.json
if [ -f "frontend/package.json" ]; then
    sed -i "s/\"version\": \"[^\"]*\"/\"version\": \"$NEW_VERSION\"/g" frontend/package.json
    echo "✓ Updated frontend/package.json"
fi

# Update package-lock.json
if [ -f "frontend/package-lock.json" ]; then
    sed -i "0,/\"version\": \"[^\"]*\"/s//\"version\": \"$NEW_VERSION\"/" frontend/package-lock.json
    echo "✓ Updated frontend/package-lock.json"
fi

echo ""
echo "✅ Version bumped to $NEW_VERSION"
echo "Files updated:"
echo "  - VERSION"
echo "  - backend/main.py"
echo "  - frontend/package.json"
echo "  - frontend/package-lock.json"
