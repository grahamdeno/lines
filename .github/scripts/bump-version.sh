#!/usr/bin/env bash
# Bumps the patch version when app files changed between two commits but the
# version did not, so installed copies of the app pick up the change.
# Usage: bump-version.sh <before-sha>
# Prints the new version if it bumped, nothing otherwise.
set -euo pipefail

BEFORE="${1:-}"
APP_FILES=(index.html "*.js" "*.css" manifest.webmanifest icons sample)

# New branch, force push past history we don't have, or no "before": nothing to compare.
if [[ -z "$BEFORE" || "$BEFORE" =~ ^0+$ ]] || ! git cat-file -e "$BEFORE^{commit}" 2>/dev/null; then
  echo "No earlier commit to compare against; skipping." >&2
  exit 0
fi

if git diff --quiet "$BEFORE" HEAD -- "${APP_FILES[@]}"; then
  echo "No app files changed; skipping." >&2
  exit 0
fi

version_in() { sed -nE 's/^export const VERSION = "([0-9]+\.[0-9]+\.[0-9]+)";.*/\1/p' <<<"$1"; }
OLD=$(version_in "$(git show "$BEFORE:core.js")")
NOW=$(version_in "$(cat core.js)")
if [[ -z "$NOW" ]]; then echo "VERSION not found in core.js" >&2; exit 1; fi

if [[ "$OLD" != "$NOW" ]]; then
  echo "Version already bumped ($OLD -> $NOW); skipping." >&2
  exit 0
fi

IFS=. read -r MA MI PA <<<"$NOW"
NEXT="$MA.$MI.$((PA + 1))"
sed -i -E "s/^export const VERSION = \"$NOW\";/export const VERSION = \"$NEXT\";/" core.js
sed -i -E "s/^const CACHE = \"lines-v[^\"]+\";/const CACHE = \"lines-v$NEXT\";/" sw.js
echo "$NEXT"
