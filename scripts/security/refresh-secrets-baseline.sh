#!/usr/bin/env bash
set -euo pipefail

# Rebuild and stage detect-secrets baseline using the repo's pinned hook version.
# This keeps .secrets.baseline compatible with pre-commit and CI.

pre-commit run detect-secrets --all-files || true
git add .secrets.baseline
pre-commit run detect-secrets --all-files
