#!/usr/bin/env node
import fs from "node:fs";
import { normalizeTranscriptDocument, validateNormalizedTranscript } from "./transcript-normalize-lib.mjs";
import { summarizeTranscriptQuality } from "./transcript-quality-lib.mjs";

const [corpusPath, videoId, transcriptPath] = process.argv.slice(2);

if (!corpusPath || !videoId || !transcriptPath) {
    console.error("Usage: node scripts/eval-matrix/prepare-transcript-cache-entry.mjs <corpus.json> <videoId> <transcript.json>");
    process.exit(1);
}

const corpus = JSON.parse(fs.readFileSync(corpusPath, "utf-8"));
const entry = corpus.find(item => item.videoId === videoId);
if (!entry) {
    console.error(`Video ${videoId} not found in corpus ${corpusPath}`);
    process.exit(1);
}

const raw = JSON.parse(fs.readFileSync(transcriptPath, "utf-8"));
const normalized = normalizeTranscriptDocument(raw);
if (!validateNormalizedTranscript(normalized)) {
    console.error(JSON.stringify({ videoId, error: "invalid_normalized_transcript" }, null, 2));
    process.exit(1);
}

const parsedDurationMinutes = Number(entry.durationMinutes);
const safeDurationMinutes = Number.isFinite(parsedDurationMinutes) ? parsedDurationMinutes : 0;
const summary = summarizeTranscriptQuality(normalized, safeDurationMinutes);
if (!summary.acceptable) {
    console.error(JSON.stringify({ videoId, summary }, null, 2));
    process.exit(1);
}

fs.writeFileSync(transcriptPath, JSON.stringify(normalized, null, 2) + "\n", "utf-8");
console.log(JSON.stringify({ videoId, summary }, null, 2));
