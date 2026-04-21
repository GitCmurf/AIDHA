#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

pnpm --dir "${ROOT_DIR}/packages/praecis/youtube" build >/dev/null
pnpm --dir "${ROOT_DIR}/packages/praecis/youtube" cli eval narrow-manual-baseline "$@"
