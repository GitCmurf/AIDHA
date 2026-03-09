#!/usr/bin/env bash
set -e

# Change to repo root
cd "$(dirname "$0")/../.."

CORPUS_JSON="packages/praecis/youtube/tests/fixtures/eval-matrix/corpus.json"
CACHE_DIR="out/eval-matrix/transcripts"
TEMP_DB="out/eval-matrix/aidha-eval.sqlite"

mkdir -p "$CACHE_DIR"
mkdir -p "$(dirname "$TEMP_DB")"

if [ ! -f "$CORPUS_JSON" ]; then
  echo "Error: Corpus file not found at $CORPUS_JSON"
  exit 1
fi

echo "Ingesting transcripts for corpus videos into $CACHE_DIR..."

node -e "
const fs = require('fs');
const corpus = JSON.parse(fs.readFileSync('$CORPUS_JSON', 'utf-8'));
corpus.forEach(entry => {
  console.log(entry.videoId + ' ' + entry.url);
});
" | while read -r videoId url; do
  TARGET_FILE="$CACHE_DIR/${videoId}.json"
  if [ -f "$TARGET_FILE" ] && [ -s "$TARGET_FILE" ]; then
    echo "Skipping $videoId - already cached"
  else
    echo "Ingesting $videoId ($url)..."

    # Ingest video
    pnpm -C packages/praecis/youtube cli ingest video "$url" --db "$TEMP_DB" || true

    # Export the transcript to our local cache dir
    # we export as JSON, wait, export transcript creates markdown or what?
    # Let me check export transcript.
    # The command is: export transcript video <videoIdOrUrl> [--db <path>] [--out <path>] [--pretty]
    # It might export Markdown or JSON.
    # Let me write a tiny script to fetch the transcript from sqlite using the Node API if needed.
    # Let's try the CLI first. It likely exports markdown or JSON.
    # Actually I can use `diagnose transcript` to output JSON.
    # diagnose transcript <videoIdOrUrl> [--mock] [--json] outputs JSON directly to stdout!
    pnpm -C packages/praecis/youtube --silent cli diagnose transcript "$videoId" --json > "$TARGET_FILE" || true

    if [ ! -s "$TARGET_FILE" ]; then
      echo "Warning: Failed to export transcript for $videoId to $TARGET_FILE"
    fi
  fi
done

echo "Done."
