#!/usr/bin/env bash
set -euo pipefail

root="${1:-.}"

echo "Running meminit scan (json) at root: ${root}"
meminit scan --root "${root}" --format json

echo "Next:"
echo "  1) Apply docops.config.yaml changes if needed"
echo "  2) meminit doctor --root \"${root}\""
echo "  3) meminit check --root \"${root}\""
