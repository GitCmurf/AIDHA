#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
RAW_DIR="${ROOT_DIR}/testdata/youtube_golden/raw"
OUT_DIR="${ROOT_DIR}/testdata/youtube_golden"

FETCH=1
NORMALIZE=1

for arg in "$@"; do
    case "${arg}" in
        --fetch-only)
            NORMALIZE=0
            ;;
        --normalize-only)
            FETCH=0
            ;;
        *)
            echo "Unknown argument: ${arg}" >&2
            echo "Usage: $0 [--fetch-only|--normalize-only]" >&2
            exit 1
            ;;
    esac
done

if [[ "${FETCH}" -eq 1 ]]; then
    mkdir -p "${RAW_DIR}"
    yt-dlp --js-runtimes node --skip-download --write-subs --write-auto-subs \
        --sub-langs "en.*,en" --sub-format ttml \
        -o "${RAW_DIR}/%(id)s.%(ext)s" \
        "https://www.youtube.com/watch?v=IN6w6GnN-Ic" \
        "https://www.youtube.com/watch?v=UepWRYgBpv0"
fi

if [[ "${NORMALIZE}" -eq 1 ]]; then
    mkdir -p "${OUT_DIR}"
    node --input-type=module <<'NODE'
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { parseTranscriptTtml } from './packages/praecis/youtube/dist/client/transcript.js';

const fixtures = [
  {
    videoId: 'IN6w6GnN-Ic',
    input: 'testdata/youtube_golden/raw/IN6w6GnN-Ic.en-orig.ttml',
    output: 'testdata/youtube_golden/IN6w6GnN-Ic.excerpts.json',
    sourceUrl: 'https://www.youtube.com/watch?v=IN6w6GnN-Ic',
    track: 'en-orig',
  },
  {
    videoId: 'UepWRYgBpv0',
    input: 'testdata/youtube_golden/raw/UepWRYgBpv0.en-orig.ttml',
    output: 'testdata/youtube_golden/UepWRYgBpv0.excerpts.json',
    sourceUrl: 'https://www.youtube.com/watch?v=UepWRYgBpv0',
    track: 'en-orig',
  },
];

for (const fixture of fixtures) {
  const ttml = await readFile(fixture.input, 'utf-8');
  const segments = parseTranscriptTtml(ttml).map((segment, index) => ({
    id: `fixture-${fixture.videoId}-${index}`,
    sequence: index,
    start: Number(segment.start.toFixed(3)),
    duration: Number(segment.duration.toFixed(3)),
    text: segment.text,
  }));

  const hash = createHash('sha256');
  for (const segment of segments) {
    hash.update(`${segment.start}|${segment.duration}|${segment.text}`);
  }

  const payload = {
    fixtureVersion: 1,
    videoId: fixture.videoId,
    sourceUrl: fixture.sourceUrl,
    transcriptTrack: fixture.track,
    parser: 'parseTranscriptTtml',
    transcriptHash: hash.digest('hex'),
    segmentCount: segments.length,
    segments,
  };

  await writeFile(fixture.output, `${JSON.stringify(payload, null, 2)}\n`, 'utf-8');
  console.log(`Wrote ${fixture.output}`);
}
NODE
fi
