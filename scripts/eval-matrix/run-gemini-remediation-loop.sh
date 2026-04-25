#!/usr/bin/env bash
set -euo pipefail

BASE_BRANCH="main"
MAX_ITERATIONS=1
REVIEW_FILE=""
VERIFY_MODE="quick"
HEARTBEAT_SECONDS=60
HARD_TIMEOUT_MINUTES=60
GEMINI_BIN="${GEMINI_BIN:-gemini}"
REVIEW_TOOL="${REVIEW_TOOL:-codex}"
REVIEW_MODEL="${REVIEW_MODEL:-gpt-5.4-mini}"
CODERABBIT_BIN="${CODERABBIT_BIN:-coderabbit}"
PNPM_BIN="${PNPM_BIN:-pnpm}"
GEMINI_APPROVAL_MODE="${GEMINI_APPROVAL_MODE:-auto_edit}"
GEMINI_SANDBOX="${GEMINI_SANDBOX:-false}"
GEMINI_SKIP_TRUST="${GEMINI_SKIP_TRUST:-true}"
GEMINI_OUTPUT_FORMAT="${GEMINI_OUTPUT_FORMAT:-text}"
RUN_ID=""
RUN_DIR=""

usage() {
    cat <<'EOF'
Usage: run-gemini-remediation-loop.sh [--review-file PATH] [--base BRANCH] [--max-iterations N] [--verify-mode quick|full|none] [--heartbeat-seconds N] [--hard-timeout-minutes N] [--review-tool codex|coderabbit]

Reads a review summary from stdin or --review-file, asks Gemini to plan and
apply the remediation, runs repo verification, then re-runs CodeRabbit against
the chosen base branch. The loop stops when the review output looks clear or
when the iteration cap is reached.

Defaults:
  --base main
  --max-iterations 1
  --verify-mode quick
  --heartbeat-seconds 60
  --hard-timeout-minutes 60

Gemini defaults:
  GEMINI_APPROVAL_MODE=auto_edit
  GEMINI_SANDBOX=false
  GEMINI_SKIP_TRUST=true
  GEMINI_OUTPUT_FORMAT=text

Review defaults:
  REVIEW_TOOL=codex
  REVIEW_MODEL=gpt-5.4-mini

Examples:
  cat review.txt | ./scripts/eval-matrix/run-gemini-remediation-loop.sh
  ./scripts/eval-matrix/run-gemini-remediation-loop.sh --review-file review.txt --max-iterations 2
  ./scripts/eval-matrix/run-gemini-remediation-loop.sh --review-file review.txt --verify-mode full
  ./scripts/eval-matrix/run-gemini-remediation-loop.sh --review-file review.txt --hard-timeout-minutes 60
  ./scripts/eval-matrix/run-gemini-remediation-loop.sh --review-file review.txt --review-tool coderabbit
EOF
}

require_command() {
    local cmd="$1"
    if ! command -v "$cmd" >/dev/null 2>&1; then
        echo "Missing required command: ${cmd}" >&2
        exit 1
    fi
}

read_review_input() {
    if [[ -n "${REVIEW_FILE}" ]]; then
        cat "${REVIEW_FILE}"
        return
    fi

    if [[ -t 0 ]]; then
        echo "Provide review text via stdin or --review-file." >&2
        exit 2
    fi

    cat
}

log() {
    printf '[loop] %s\n' "$*" >&2
}

elapsed_seconds() {
    local started_at="$1"
    printf '%s' $(( $(date +%s) - started_at ))
}

stage_log_file() {
    local stage="$1"
    printf '%s/%s.log' "${RUN_DIR}" "${stage}"
}

run_with_heartbeat() {
    local stage="$1"
    local heartbeat_seconds="$2"
    shift 2

    local log_file
    log_file="$(stage_log_file "${stage}")"
    local started_at
    started_at="$(date +%s)"

    log "stage=${stage} status=start log=${log_file}"

    local timeout_seconds=$(( HARD_TIMEOUT_MINUTES * 60 ))
    (
        timeout --foreground --signal=TERM --kill-after=5m "${timeout_seconds}s" "$@"
    ) >"${log_file}" 2>&1 &
    local pid=$!
    local last_heartbeat
    last_heartbeat="${started_at}"

    while kill -0 "${pid}" 2>/dev/null; do
        local now
        now="$(date +%s)"
        if (( now - last_heartbeat >= heartbeat_seconds )); then
            log "stage=${stage} status=running elapsed=$(elapsed_seconds "${started_at}")s pid=${pid}"
            last_heartbeat="${now}"
        fi
        sleep 5
    done

    local rc=0
    if wait "${pid}"; then
        rc=0
    else
        rc=$?
    fi

    if (( rc == 0 )); then
        log "stage=${stage} status=done elapsed=$(elapsed_seconds "${started_at}")s log=${log_file}"
    else
        log "stage=${stage} status=failed rc=${rc} elapsed=$(elapsed_seconds "${started_at}")s log=${log_file}"
        if (( rc == 124 )); then
            log "stage=${stage} status=timeout limit=${HARD_TIMEOUT_MINUTES}m log=${log_file}"
        fi
        tail -n 80 "${log_file}" >&2 || true
    fi

    cat "${log_file}"

    return "${rc}"
}

build_prompt() {
    local iteration="$1"
    local review_input="$2"

    cat <<EOF
You are working in the AIDHA repository at $(git rev-parse --show-toplevel).
Base branch: ${BASE_BRANCH}.

Task:
Classify each review finding below before changing code:
- true positive: reproduce it in the current codebase and fix it
- false positive: explain briefly why it does not apply and do not change code
- needs better patch: the issue is real, but choose a smaller or safer fix than the suggestion

Plan and execute the minimum remediation needed to address only the findings
that survive that filtering. Make the edits directly in the working tree, run
the relevant verification commands, and return only a tight summary.

Hard requirements:
- Preserve unrelated user changes.
- Do not ask questions.
- Keep the response concise.
- Include files changed, commands run, and whether the branch is ready or still blocked.
- Prefer the smallest correct patch when the suggested fix is too broad.

Iteration ${iteration}/${MAX_ITERATIONS}

Review findings:
<<<BEGIN REVIEW>>>
${review_input}
<<<END REVIEW>>>
EOF
}

run_gemini() {
    local prompt="$1"
    local -a gemini_args=()

    gemini_args+=(--approval-mode "${GEMINI_APPROVAL_MODE}")
    gemini_args+=(--sandbox "${GEMINI_SANDBOX}")
    gemini_args+=(--output-format "${GEMINI_OUTPUT_FORMAT}")

    if [[ "${GEMINI_SKIP_TRUST}" == "true" ]]; then
        gemini_args+=(--skip-trust)
    fi

    run_with_heartbeat "gemini-iteration-${CURRENT_ITERATION}" "${HEARTBEAT_SECONDS}" "${GEMINI_BIN}" "${gemini_args[@]}" -p "${prompt}"
}

run_verification_mode() {
    local root_dir="$1"
    local verify_mode="$2"
    local youtube_dir="${root_dir}/packages/praecis/youtube"

    case "${verify_mode}" in
        none)
            log "stage=verification status=skipped mode=none"
            return 0
            ;;
        quick)
            run_with_heartbeat "verification-build" "${HEARTBEAT_SECONDS}" "${PNPM_BIN}" --dir "${youtube_dir}" build
            run_with_heartbeat "verification-vitest" "${HEARTBEAT_SECONDS}" "${PNPM_BIN}" --dir "${youtube_dir}" exec vitest run \
                tests/eval/narrow-manual-baseline.test.ts \
                tests/eval/matrix-runner.test.ts \
                tests/eval/quality-gate.test.ts \
                tests/eval/gemini-embedding-client.test.ts \
                tests/prompt-routing.test.ts \
                tests/llm-claims.test.ts \
                tests/pipeline.test.ts
            ;;
        full)
            run_verification_mode "${root_dir}" quick
            run_with_heartbeat "verification-docs-build" "${HEARTBEAT_SECONDS}" "${PNPM_BIN}" --dir "${root_dir}" run docs:build
            ;;
        *)
            echo "--verify-mode must be one of: quick, full, none." >&2
            exit 2
            ;;
    esac
}

run_review() {
    case "${REVIEW_TOOL}" in
        codex)
            require_command codex
            run_with_heartbeat "codex-review" "${HEARTBEAT_SECONDS}" codex review --model "${REVIEW_MODEL}" --base "${BASE_BRANCH}"
            ;;
        coderabbit)
            require_command "${CODERABBIT_BIN}"
            if ! "${CODERABBIT_BIN}" auth status >/dev/null 2>&1; then
                echo "CodeRabbit CLI is not authenticated. Run: coderabbit auth login" >&2
                exit 1
            fi
            run_with_heartbeat "coderabbit-review" "${HEARTBEAT_SECONDS}" "${CODERABBIT_BIN}" review --prompt-only --base "${BASE_BRANCH}"
            ;;
        *)
            echo "--review-tool must be one of: codex, coderabbit." >&2
            exit 2
            ;;
    esac
}

review_looks_clear() {
    local review_output="$1"

    if [[ -z "${review_output//[[:space:]]/}" ]]; then
        return 1
    fi

    if grep -Eq '\[P[0-9]+\]' <<<"${review_output}"; then
        return 1
    fi

    if grep -Eqi 'no (issues|findings|problems|further issues)|looks good|approved|lgtm|nothing to do' <<<"${review_output}"; then
        return 0
    fi

    return 1
}

main() {
    local root_dir
    root_dir="$(git rev-parse --show-toplevel)"

    local review_input
    review_input="$(read_review_input)"
    if [[ -z "${review_input//[[:space:]]/}" ]]; then
        echo "Review input is empty." >&2
        exit 2
    fi

    RUN_ID="$(date -u +%Y%m%dT%H%M%SZ)-$$"
    RUN_DIR="${TMPDIR:-/tmp}/aidha-gemini-remediation-${RUN_ID}"
    mkdir -p "${RUN_DIR}"
    log "run_dir=${RUN_DIR}"
    log "verify_mode=${VERIFY_MODE}"
    log "review_tool=${REVIEW_TOOL}"

    require_command "${GEMINI_BIN}"
    require_command "${PNPM_BIN}"

    local iteration
    for ((iteration = 1; iteration <= MAX_ITERATIONS; iteration++)); do
        CURRENT_ITERATION="${iteration}"
        log "iteration=${iteration}/${MAX_ITERATIONS}"

        local prompt
        prompt="$(build_prompt "${iteration}" "${review_input}")"

        local gemini_output
        gemini_output=""
        if gemini_output="$(run_gemini "${prompt}")"; then
            printf '%s\n' "${gemini_output}"
        else
            local gemini_rc=$?
            log "gemini failed rc=${gemini_rc} iteration=${iteration}"
            log "gemini log=$(stage_log_file "gemini-iteration-${iteration}")"
            exit "${gemini_rc}"
        fi

        log "stage=verification status=start mode=${VERIFY_MODE}"
        local verification_output
        if verification_output="$(run_verification_mode "${root_dir}" "${VERIFY_MODE}")"; then
            printf '%s\n' "${verification_output}"
        else
            local verification_rc=$?
            printf '%s\n' "${verification_output}"
            log "verification failed rc=${verification_rc}"
            exit "${verification_rc}"
        fi
        log "stage=verification status=done mode=${VERIFY_MODE}"

        log "stage=${REVIEW_TOOL}-review status=start base=${BASE_BRANCH}"
        local review_output
        review_output=""
        if review_output="$(run_review)"; then
            printf '%s\n' "${review_output}"
        else
            local review_rc=$?
            log "review tool exited rc=${review_rc}"
            log "review log=$(stage_log_file "${REVIEW_TOOL}-review")"
            printf '%s\n' "${review_output}"
            if (( iteration == MAX_ITERATIONS )); then
                exit "${review_rc}"
            fi
        fi

        if review_looks_clear "${review_output}"; then
            log "review looks clear"
            return 0
        fi

        if (( iteration == MAX_ITERATIONS )); then
            log "review still has findings after ${MAX_ITERATIONS} iteration(s)"
            return 1
        fi

        review_input=$(
            cat <<EOF
Previous review findings:
${review_output}

Gemini summary:
${gemini_output}
EOF
        )
    done
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
    usage
    exit 0
fi

while [[ $# -gt 0 ]]; do
    case "$1" in
        --review-file)
            REVIEW_FILE="${2:-}"
            shift 2
            ;;
        --base)
            BASE_BRANCH="${2:-}"
            shift 2
            ;;
        --max-iterations)
            MAX_ITERATIONS="${2:-}"
            shift 2
            ;;
        --verify-mode)
            VERIFY_MODE="${2:-}"
            shift 2
            ;;
        --heartbeat-seconds)
            HEARTBEAT_SECONDS="${2:-}"
            shift 2
            ;;
        --hard-timeout-minutes)
            HARD_TIMEOUT_MINUTES="${2:-}"
            shift 2
            ;;
        --review-tool)
    REVIEW_TOOL="${2:-}"
    shift 2
    ;;
        --review-model)
            REVIEW_MODEL="${2:-}"
            shift 2
            ;;
        -h|--help)
            usage
            exit 0
            ;;
        *)
            echo "Unknown argument: $1" >&2
            usage >&2
            exit 2
            ;;
    esac
done

if ! [[ "${MAX_ITERATIONS}" =~ ^[1-9][0-9]*$ ]]; then
    echo "--max-iterations must be a positive integer." >&2
    exit 2
fi

if ! [[ "${HEARTBEAT_SECONDS}" =~ ^[1-9][0-9]*$ ]]; then
    echo "--heartbeat-seconds must be a positive integer." >&2
    exit 2
fi

if ! [[ "${HARD_TIMEOUT_MINUTES}" =~ ^[1-9][0-9]*$ ]]; then
    echo "--hard-timeout-minutes must be a positive integer." >&2
    exit 2
fi

case "${VERIFY_MODE}" in
    quick|full|none)
        ;;
    *)
        echo "--verify-mode must be one of: quick, full, none." >&2
        exit 2
        ;;
esac

case "${REVIEW_TOOL}" in
    codex|coderabbit)
        ;;
    *)
        echo "--review-tool must be one of: codex, coderabbit." >&2
        exit 2
        ;;
esac

if [[ "${REVIEW_TOOL}" == "codex" ]]; then
    if [[ -z "${REVIEW_MODEL}" ]]; then
        echo "--review-model must not be empty when using codex." >&2
        exit 2
    fi
fi

main
