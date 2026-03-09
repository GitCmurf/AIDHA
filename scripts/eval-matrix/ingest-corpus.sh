#!/usr/bin/env bash
set -euo pipefail

# Change to repo root
cd "$(dirname "$0")/../.."

CORPUS_JSON="packages/praecis/youtube/tests/fixtures/eval-matrix/corpus.json"
CACHE_DIR="out/eval-matrix/transcripts"
TEMP_DB="out/eval-matrix/aidha-eval.sqlite"

mkdir --parents "$CACHE_DIR"
mkdir --parents "$(dirname "$TEMP_DB")"

if [ ! -f "$CORPUS_JSON" ]; then
    echo "Error: Corpus file not found at $CORPUS_JSON"
    exit 1
fi

echo "Ingesting transcripts for corpus videos into $CACHE_DIR..."

# Use process substitution to avoid subshell so exit 1 works correctly
while read -r videoId url; do
    TARGET_FILE="$CACHE_DIR/${videoId}.json"
    if [ -f "$TARGET_FILE" ] && [ -s "$TARGET_FILE" ]; then
        echo "Skipping $videoId - already cached"
    else
        echo "Ingesting $videoId ($url)..."

        # Ingest video
        pnpm --dir packages/praecis/youtube cli ingest video "$url" --db "$TEMP_DB"

        # Export the transcript to our local cache dir as JSON
        # We use a temporary file to avoid truncated cache files on failure.
        TEMP_EXPORT_FILE=$(mktemp)
        if pnpm --dir packages/praecis/youtube --silent cli export transcript video "$videoId" --db "$TEMP_DB" --out "$TEMP_EXPORT_FILE" --pretty; then
            mv "$TEMP_EXPORT_FILE" "$TARGET_FILE"
            echo "Successfully cached transcript for $videoId"
        else
            rm -f "$TEMP_EXPORT_FILE"
            echo "Error: Failed to export transcript for $videoId"
            exit 1
        fi
    fi
done < <(node --eval "
const fs = require('fs');
const corpus = JSON.parse(fs.readFileSync('$CORPUS_JSON', 'utf-8'));
corpus.forEach(entry => {
    console.log(entry.videoId + ' ' + entry.url);
});
")

echo "Done."
