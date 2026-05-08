#!/usr/bin/env bash
set -euo pipefail

main() {
    local root_dir
    root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

    pnpm --dir "${root_dir}/packages/praecis/youtube" cli eval narrow-manual-baseline "$@"
}

main "$@"
