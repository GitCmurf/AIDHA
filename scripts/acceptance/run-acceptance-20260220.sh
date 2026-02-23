#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
RUN_DIR="${ROOT_DIR}/docs/55-testing/acceptance-run-20260220"
ARTIFACT_DIR="${RUN_DIR}/artifacts"
LOG_DIR="${RUN_DIR}/logs"
WORK_DIR="${ROOT_DIR}/.cache/acceptance-20260220"
DB_PATH="${WORK_DIR}/acceptance.sqlite"
LLM_DB_PATH="${WORK_DIR}/acceptance-llm.sqlite"
COMMAND_LOG="${LOG_DIR}/commands.log"

mkdir -p "${ARTIFACT_DIR}" "${LOG_DIR}" "${WORK_DIR}"
rm -f "${DB_PATH}" "${LLM_DB_PATH}"
rm -rf "${ROOT_DIR}/out"
mkdir -p "${ROOT_DIR}/out"
: > "${COMMAND_LOG}"

run_cmd() {
    local label="$1"
    shift
    {
        echo "### ${label}"
        echo "\$ $*"
    } >> "${COMMAND_LOG}"
    "$@" >> "${COMMAND_LOG}" 2>&1
    echo >> "${COMMAND_LOG}"
}

# Heuristic (non-LLM) acceptance lane
run_cmd "ingest-mock" pnpm -C "${ROOT_DIR}/packages/praecis/youtube" cli ingest video test-video --mock --db "${DB_PATH}"
run_cmd "extract-claims-heuristic" pnpm -C "${ROOT_DIR}/packages/praecis/youtube" cli extract claims test-video --db "${DB_PATH}"
run_cmd "extract-refs-heuristic" pnpm -C "${ROOT_DIR}/packages/praecis/youtube" cli extract refs test-video --db "${DB_PATH}"
run_cmd "export-dossier-heuristic" pnpm -C "${ROOT_DIR}/packages/praecis/youtube" cli export dossier video test-video --db "${DB_PATH}" --split-states --out "${ARTIFACT_DIR}/dossier-test-video-heuristic.txt"
mv -f "${ARTIFACT_DIR}/dossier-test-video-heuristic.txt.draft.md" "${ARTIFACT_DIR}/dossier-test-video-heuristic.draft.txt"
run_cmd "export-transcript-heuristic" pnpm -C "${ROOT_DIR}/packages/praecis/youtube" cli export transcript video test-video --db "${DB_PATH}" --out "${ARTIFACT_DIR}/transcript-test-video-heuristic.json"
run_cmd "query-heuristic" pnpm -C "${ROOT_DIR}/packages/praecis/youtube" cli query TypeScript --db "${DB_PATH}"
run_cmd "task-create-heuristic" pnpm -C "${ROOT_DIR}/packages/praecis/youtube" cli task create --title "Follow up on TypeScript note" --db "${DB_PATH}" --allow-empty

# Determinism rerun for heuristic outputs
run_cmd "extract-claims-heuristic-rerun" pnpm -C "${ROOT_DIR}/packages/praecis/youtube" cli extract claims test-video --db "${DB_PATH}"
run_cmd "extract-refs-heuristic-rerun" pnpm -C "${ROOT_DIR}/packages/praecis/youtube" cli extract refs test-video --db "${DB_PATH}"
run_cmd "export-dossier-heuristic-rerun" pnpm -C "${ROOT_DIR}/packages/praecis/youtube" cli export dossier video test-video --db "${DB_PATH}" --split-states --out "${ARTIFACT_DIR}/dossier-test-video-heuristic-rerun.txt"
mv -f "${ARTIFACT_DIR}/dossier-test-video-heuristic-rerun.txt.draft.md" "${ARTIFACT_DIR}/dossier-test-video-heuristic-rerun.draft.txt"
run_cmd "export-transcript-heuristic-rerun" pnpm -C "${ROOT_DIR}/packages/praecis/youtube" cli export transcript video test-video --db "${DB_PATH}" --out "${ARTIFACT_DIR}/transcript-test-video-heuristic-rerun.json"

# LLM-backed lane (offline, deterministic mock LLM client)
run_cmd "llm-offline-acceptance" node "${ROOT_DIR}/scripts/acceptance/llm-offline-acceptance.mjs" \
  --db "${LLM_DB_PATH}" \
  --dossier-out "${ARTIFACT_DIR}/dossier-test-video-llm.txt" \
  --transcript-out "${ARTIFACT_DIR}/transcript-test-video-llm.json" \
  --summary-out "${ARTIFACT_DIR}/llm-acceptance-summary.json"

# Golden fixture and parity checks
run_cmd "reconditum-contract" pnpm -C "${ROOT_DIR}/packages/reconditum" test -- tests/contract/store.contract.test.ts
run_cmd "golden-fixtures" pnpm -C "${ROOT_DIR}/packages/praecis/youtube" test -- tests/golden-fixtures.test.ts

# Docs gate used for release readiness evidence
run_cmd "docs-build" pnpm -C "${ROOT_DIR}" docs:build

# checksums for deterministic artifact comparison
( cd "${ARTIFACT_DIR}" && sha256sum \
    dossier-test-video-heuristic.txt \
    dossier-test-video-heuristic.draft.txt \
    dossier-test-video-heuristic-rerun.txt \
    dossier-test-video-heuristic-rerun.draft.txt \
    transcript-test-video-heuristic.json \
    transcript-test-video-heuristic-rerun.json \
    dossier-test-video-llm.txt \
    transcript-test-video-llm.json \
    llm-acceptance-summary.json \
    > "${ARTIFACT_DIR}/sha256.txt" )

echo "Acceptance run completed. Logs: ${COMMAND_LOG}" >&2
