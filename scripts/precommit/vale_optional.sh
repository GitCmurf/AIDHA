#!/usr/bin/env bash
set -euo pipefail

run_vale_if_available() {
    if command -v vale >/dev/null 2>&1; then
        vale "$@"
        return 0
    fi

    echo "Vale not found; skipping (optional)." >&2
}

run_vale_if_available "$@"
