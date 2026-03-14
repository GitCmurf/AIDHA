#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import {
    createNextBackupDir,
    normalizeTranscriptDocument,
    validateNormalizedTranscript,
} from "./transcript-normalize-lib.mjs";

function usage() {
    console.error("Usage: node scripts/eval-matrix/normalize-transcripts.mjs <transcript-dir> [--backup-root <dir>]");
    process.exit(1);
}

const transcriptDir = process.argv[2];
const backupRootIndex = process.argv.indexOf("--backup-root");
let backupRoot = "out/eval-matrix/transcript-backups";
if (backupRootIndex >= 0) {
    backupRoot = process.argv[backupRootIndex + 1];
    if (!backupRoot) {
        usage();
    }
}

if (!transcriptDir) {
    usage();
}

const files = fs.readdirSync(transcriptDir)
    .filter(name => name.endsWith(".json"))
    .sort();

if (files.length === 0) {
    throw new Error(`No transcript JSON files found in ${transcriptDir}`);
}

const backupDir = createNextBackupDir(backupRoot);
const manifest = [];

for (const file of files) {
    const sourcePath = path.join(transcriptDir, file);
    const backupPath = path.join(backupDir, file);
    fs.copyFileSync(sourcePath, backupPath);

    const raw = JSON.parse(fs.readFileSync(sourcePath, "utf-8"));
    const normalized = normalizeTranscriptDocument(raw);
    if (!validateNormalizedTranscript(normalized)) {
        throw new Error(`Normalization produced invalid transcript for ${file}`);
    }

    fs.writeFileSync(sourcePath, JSON.stringify(normalized, null, 2) + "\n", "utf-8");
    manifest.push({ file, backupPath });
}

fs.writeFileSync(
    path.join(backupDir, "manifest.json"),
    JSON.stringify({ createdAt: new Date().toISOString(), files: manifest }, null, 2) + "\n",
    "utf-8",
);

console.log(`Backed up ${files.length} transcripts to ${backupDir}`);
console.log(`Normalized ${files.length} transcripts in ${transcriptDir}`);
