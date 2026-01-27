#!/usr/bin/env bash
set -euo pipefail

sync_meminit_skill() {
    local meminit_root="${1}"
    local source_dir="${meminit_root}/.codex/skills/meminit-docops"
    local target_dir=".codex/skills/meminit-docops"

    if [[ ! -d "${source_dir}" ]]; then
        echo "ERROR: meminit-docops skill not found at: ${source_dir}" >&2
        return 1
    fi

    mkdir -p "$(dirname "${target_dir}")"

    rm -rf "${target_dir}"
    cp -a "${source_dir}" "${target_dir}"

    echo "Synced meminit-docops skill from ${source_dir} -> ${target_dir}" >&2
}

main() {
    if [[ $# -ne 1 ]]; then
        echo "Usage: $0 /path/to/Meminit" >&2
        return 2
    fi

    sync_meminit_skill "$1"
}

main "$@"
