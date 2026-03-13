#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { buildCorpusEntry, sanitizeYouTubeUrl } from "./corpus-builder-lib.mjs";

function usage() {
    console.error("Usage: node scripts/eval-matrix/build-corpus-from-urls.mjs <urls.txt> <output.json>");
    process.exit(1);
}

const inputPath = process.argv[2];
const outputPath = process.argv[3];

if (!inputPath || !outputPath) {
    usage();
}

const rawLines = fs.readFileSync(inputPath, "utf-8")
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);

if (rawLines.length === 0) {
    throw new Error(`No URLs found in ${inputPath}`);
}

const entries = [];
const failures = [];

for (const rawUrl of rawLines) {
    const sanitizedUrl = sanitizeYouTubeUrl(rawUrl);
    console.log(`Fetching metadata for ${sanitizedUrl}...`);
    const result = spawnSync(
        "yt-dlp",
        [
            "--dump-single-json",
            "--no-warnings",
            "--no-playlist",
            "--skip-download",
            "--socket-timeout",
            "20",
            "--retries",
            "1",
            "--extractor-retries",
            "1",
            sanitizedUrl,
        ],
        {
            encoding: "utf-8",
            timeout: 60000,
        }
    );

    if (result.error) {
        console.error(`Warning: yt-dlp error for ${sanitizedUrl}: ${result.error.message}`);
        failures.push({ url: sanitizedUrl, error: result.error.message });
        continue;
    }

    if (result.status !== 0) {
        console.error(`Warning: yt-dlp failed for ${sanitizedUrl}: ${result.stderr || result.stdout}`);
        failures.push({ url: sanitizedUrl, error: result.stderr || result.stdout });
        continue;
    }

    try {
        const metadata = JSON.parse(result.stdout);
        entries.push(buildCorpusEntry({
            videoId: metadata.id,
            sourceUrl: sanitizedUrl,
            title: metadata.title,
            channelName: metadata.channel || metadata.uploader || metadata.uploader_id || "unknown",
            durationSeconds: metadata.duration || 0,
            description: metadata.description || "",
            language: metadata.language || "en",
        }));
    } catch (parseError) {
        console.error(`Warning: Failed to parse metadata for ${sanitizedUrl}: ${parseError instanceof Error ? parseError.message : String(parseError)}`);
        failures.push({ url: sanitizedUrl, error: `Parse error: ${parseError instanceof Error ? parseError.message : String(parseError)}` });
    }
}

if (failures.length > 0) {
    console.error(`\n${failures.length} URL(s) failed:`);
    for (const f of failures) {
        console.error(`  - ${f.url}: ${f.error}`);
    }
}

if (entries.length === 0) {
    throw new Error("No entries could be processed successfully");
}

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, JSON.stringify(entries, null, 2) + "\n", "utf-8");

console.log(`Wrote ${entries.length} corpus entries to ${outputPath}`);

if (failures.length > 0) {
    process.exit(1);
}
