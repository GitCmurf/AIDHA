#!/usr/bin/env bash
set -euo pipefail

# Change to repo root
cd "$(dirname "$0")/../.."

CORPUS_JSON="packages/praecis/youtube/tests/fixtures/eval-matrix/corpus.json"
CACHE_DIR="out/eval-matrix/transcripts"
TEMP_DB="out/eval-matrix/aidha-eval.sqlite"
CONFIG_PATH=".aidha/config.yaml"
YTDLP_JS_RUNTIMES="node"
YTDLP_COOKIES="${AIDHA_YTDLP_COOKIES_FILE:-${YTDLP_COOKIES_FILE:-${YTDLP_COOKIES:-}}}"
REQUEST_DELAY_SECONDS=12
FAILURE_DELAY_SECONDS=90
VIDEO_ID_FILTER=""

usage() {
    cat <<'EOF'
Usage: scripts/eval-matrix/ingest-corpus.sh [options]

Options:
    --corpus <path>       Path to evaluation corpus JSON.
    --cache-dir <path>    Directory to store transcript JSON cache files.
    --db <path>           SQLite database path for temporary ingest/export work.
    --config <path>       AIDHA config file passed through to the CLI.
    --ytdlp-js-runtimes <list>
                          JavaScript runtimes passed to yt-dlp during ingest.
    --ytdlp-cookies <path>
                          Netscape-format cookies file passed to yt-dlp.
    --request-delay-seconds <n>
                          Delay between video requests to avoid bursty access.
    --failure-delay-seconds <n>
                          Cooldown after a failed video before exiting.
    --video-id <id>       Ingest only a single videoId from the corpus.
    --help                Show this help text.
EOF
}

while [ "$#" -gt 0 ]; do
    case "$1" in
        --corpus)
            CORPUS_JSON="${2:-}"
            shift 2
            ;;
        --cache-dir)
            CACHE_DIR="${2:-}"
            shift 2
            ;;
        --db)
            TEMP_DB="${2:-}"
            shift 2
            ;;
        --config)
            CONFIG_PATH="${2:-}"
            shift 2
            ;;
        --ytdlp-js-runtimes)
            YTDLP_JS_RUNTIMES="${2:-}"
            shift 2
            ;;
        --ytdlp-cookies)
            YTDLP_COOKIES="${2:-}"
            shift 2
            ;;
        --request-delay-seconds)
            REQUEST_DELAY_SECONDS="${2:-}"
            shift 2
            ;;
        --failure-delay-seconds)
            FAILURE_DELAY_SECONDS="${2:-}"
            shift 2
            ;;
        --video-id)
            VIDEO_ID_FILTER="${2:-}"
            shift 2
            ;;
        --help)
            usage
            exit 0
            ;;
        *)
            echo "Error: Unknown option '$1'" >&2
            usage >&2
            exit 1
            ;;
    esac
done

if [ -z "$CORPUS_JSON" ] || [ -z "$CACHE_DIR" ] || [ -z "$TEMP_DB" ] || [ -z "$CONFIG_PATH" ] || [ -z "$YTDLP_JS_RUNTIMES" ] || [ -z "$REQUEST_DELAY_SECONDS" ] || [ -z "$FAILURE_DELAY_SECONDS" ]; then
    echo "Error: --corpus, --cache-dir, --db, --config, --ytdlp-js-runtimes, --request-delay-seconds, and --failure-delay-seconds values must not be empty." >&2
    exit 1
fi

if ! [[ "$REQUEST_DELAY_SECONDS" =~ ^[0-9]+$ ]] || ! [[ "$FAILURE_DELAY_SECONDS" =~ ^[0-9]+$ ]]; then
    echo "Error: --request-delay-seconds and --failure-delay-seconds must be non-negative integers." >&2
    exit 1
fi

mkdir -p "$CACHE_DIR"
mkdir -p "$(dirname "$TEMP_DB")"

if [ ! -f "$CORPUS_JSON" ]; then
    echo "Error: Corpus file not found at $CORPUS_JSON" >&2
    exit 1
fi

if [ ! -f "$CONFIG_PATH" ]; then
    echo "Error: Config file not found at $CONFIG_PATH" >&2
    exit 1
fi

CONFIG_PATH="$(realpath "$CONFIG_PATH")"

echo "Ingesting transcripts for corpus videos into $CACHE_DIR..."

transcript_has_segments() {
    local transcript_file="$1"
    jq -e '(.segments | type == "array") and ((.segments | length) > 0)' "$transcript_file" >/dev/null 2>&1
}

sleep_between_requests() {
    if [ "$REQUEST_DELAY_SECONDS" -gt 0 ]; then
        echo "Waiting ${REQUEST_DELAY_SECONDS}s before the next request..."
        sleep "$REQUEST_DELAY_SECONDS"
    fi
}

sleep_after_failure() {
    if [ "$FAILURE_DELAY_SECONDS" -gt 0 ]; then
        echo "Cooling down for ${FAILURE_DELAY_SECONDS}s after failure..."
        sleep "$FAILURE_DELAY_SECONDS"
    fi
}

# Use process substitution to avoid subshell so exit 1 works correctly
while read -r videoId url; do
    TARGET_FILE="$CACHE_DIR/${videoId}.json"
    if [ -f "$TARGET_FILE" ] && [ -s "$TARGET_FILE" ] && transcript_has_segments "$TARGET_FILE"; then
        echo "Skipping $videoId - already cached"
    else
        if [ -f "$TARGET_FILE" ]; then
            echo "Refreshing $videoId - cached transcript is missing segments"
            rm -f "$TARGET_FILE"
        fi
        echo "Ingesting $videoId ($url)..."

        # Ingest video
        INGEST_ARGS=(
            --dir packages/praecis/youtube
            cli --config "$CONFIG_PATH" ingest video "$url"
            --db "$TEMP_DB"
            --ytdlp-js-runtimes "$YTDLP_JS_RUNTIMES"
        )
        if [ -n "$YTDLP_COOKIES" ]; then
            INGEST_ARGS+=(--ytdlp-cookies "$YTDLP_COOKIES")
        fi
        pnpm "${INGEST_ARGS[@]}"

        # Export the transcript to our local cache dir as JSON
        # We use a temporary file to avoid truncated cache files on failure.
        TEMP_EXPORT_FILE=$(mktemp)
        if pnpm --dir packages/praecis/youtube --silent cli --config "$CONFIG_PATH" export transcript video "$videoId" --db "$TEMP_DB" --out "$TEMP_EXPORT_FILE" --pretty; then
            if node scripts/eval-matrix/prepare-transcript-cache-entry.mjs "$CORPUS_JSON" "$videoId" "$TEMP_EXPORT_FILE" >/dev/null; then
                mv "$TEMP_EXPORT_FILE" "$TARGET_FILE"
                echo "Successfully cached transcript for $videoId"
            else
                rm -f "$TEMP_EXPORT_FILE"
                echo "Error: Transcript for $videoId failed normalization or sanity checks" >&2
                sleep_after_failure
                exit 1
            fi
        else
            rm -f "$TEMP_EXPORT_FILE"
            echo "Error: Failed to export transcript for $videoId" >&2
            sleep_after_failure
            exit 1
        fi

        sleep_between_requests
    fi
done < <(node --eval "
const fs = require('fs');
const corpus = JSON.parse(fs.readFileSync('$CORPUS_JSON', 'utf-8'));
const filterVideoId = '$VIDEO_ID_FILTER';
corpus.forEach(entry => {
    if (!filterVideoId || entry.videoId === filterVideoId) {
        console.log(entry.videoId + ' ' + entry.url);
    }
});
")

echo "Done."
