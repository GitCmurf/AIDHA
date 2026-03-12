#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { createNextBackupDir, normalizeTranscriptDocument, validateNormalizedTranscript } from "./transcript-normalize-lib.mjs";
import { summarizeTranscriptQuality } from "./transcript-quality-lib.mjs";

function usage() {
    console.error("Usage: node scripts/eval-matrix/refresh-transcript-cache-direct.mjs --corpus <path> --cache-dir <path> --video-id <id> [--cookies <path>] [--backup-root <path>]");
    process.exit(1);
}

function requireValue(flag, value) {
    if (!value) throw new Error(`${flag} requires a value`);
    return value;
}

function parseArgs(argv) {
    const opts = {
        corpusPath: "",
        cacheDir: "out/eval-matrix/transcripts",
        videoId: "",
        cookiesPath: process.env.AIDHA_YTDLP_COOKIES_FILE || "",
        backupRoot: "out/eval-matrix/transcript-backups",
    };
    for (let i = 0; i < argv.length; i += 1) {
        const arg = argv[i];
        const value = argv[i + 1];
        switch (arg) {
            case "--corpus": opts.corpusPath = requireValue("--corpus", value); i += 1; break;
            case "--cache-dir": opts.cacheDir = requireValue("--cache-dir", value); i += 1; break;
            case "--video-id": opts.videoId = requireValue("--video-id", value); i += 1; break;
            case "--cookies": opts.cookiesPath = requireValue("--cookies", value); i += 1; break;
            case "--backup-root": opts.backupRoot = requireValue("--backup-root", value); i += 1; break;
            case "--help": usage(); break;
            default: throw new Error(`Unknown option: ${arg}`);
        }
    }
    if (!opts.corpusPath || !opts.videoId) usage();
    if (!/^[a-zA-Z0-9_-]{1,100}$/.test(opts.videoId) || opts.videoId.includes("..")) {
        throw new Error(`Invalid videoId: ${opts.videoId}`);
    }
    return opts;
}

function coverageScore(segments) {
    if (!segments.length) return 0;
    const last = segments[segments.length - 1];
    const end = (last.start || 0) + (last.duration || 0);
    return (end * 1000) + segments.length;
}

async function main() {
    let tmpDir;
    try {
        const opts = parseArgs(process.argv.slice(2));
    const corpus = JSON.parse(fs.readFileSync(opts.corpusPath, "utf-8"));
    const entry = corpus.find(item => item.videoId === opts.videoId);
    if (!entry) {
      throw new Error(`Video ${opts.videoId} not found in corpus`);
    }

    const transcriptModuleUrl = pathToFileURL(path.resolve("packages/praecis/youtube/dist/client/transcript.js")).href;
    const transcriptModule = await import(transcriptModuleUrl);
    const parsers = {
        ".vtt": transcriptModule.parseTranscriptVtt,
        ".ttml": transcriptModule.parseTranscriptTtml,
        ".xml": transcriptModule.parseTranscriptTtml,
        ".json3": transcriptModule.parseTranscriptJson,
        ".json": transcriptModule.parseTranscriptJson,
    };

    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "aidha-direct-ytdlp-"));
    const outputTemplate = path.join(tmpDir, "%(id)s.%(ext)s");
    const args = [
        "--skip-download",
        "--write-subs",
        "--write-auto-subs",
        "--ignore-errors",
        "--sub-langs", "en.*,en",
        "--sub-format", "vtt/ttml/json3",
        "--no-progress",
        "--output", outputTemplate,
        "--js-runtimes", "node",
    ];
    const remoteComponents = process.env.AIDHA_YTDLP_REMOTE_COMPONENTS || process.env.YTDLP_REMOTE_COMPONENTS || "";
    if (remoteComponents) {
        args.push("--remote-components", remoteComponents);
    }
    if (opts.cookiesPath) {
        args.push("--cookies", opts.cookiesPath);
    }
    args.push(`https://www.youtube.com/watch?v=${opts.videoId}`);

    const result = spawnSync("yt-dlp", args, { encoding: "utf-8", timeout: 240000 });
    if (result.error) throw result.error;
    if (result.status !== 0) {
        throw new Error(result.stderr || result.stdout || `yt-dlp failed with status ${result.status}`);
    }

    const files = fs.readdirSync(tmpDir)
        .filter(name => [".vtt", ".ttml", ".xml", ".json3", ".json"].includes(path.extname(name).toLowerCase()))
        .map(name => path.join(tmpDir, name));

    let best = null;
    for (const file of files) {
        const ext = path.extname(file).toLowerCase();
        const parser = parsers[ext];
        if (!parser) continue;
        const payload = fs.readFileSync(file, "utf-8");
        const segments = parser(payload);
        if (!Array.isArray(segments) || segments.length === 0) continue;
        const score = coverageScore(segments);
        if (!best || score > best.score) {
            best = { file, score, segments };
        }
    }
    if (!best) {
        throw new Error(`No subtitle track with segments found for ${opts.videoId}`);
    }

    const normalized = normalizeTranscriptDocument({
        videoId: opts.videoId,
        language: "en",
        segments: best.segments,
        fullText: best.segments.map(segment => segment.text).join(" "),
    });
    if (!validateNormalizedTranscript(normalized)) {
        throw new Error(`Normalized transcript invalid for ${opts.videoId}`);
    }
    const summary = summarizeTranscriptQuality(normalized, Number(entry.durationMinutes || 0));
    if (!summary.acceptable) {
        throw new Error(`Transcript failed sanity checks for ${opts.videoId}: ${summary.flags.join(", ")}`);
    }

    const backupDir = createNextBackupDir(opts.backupRoot);
    fs.mkdirSync(opts.cacheDir, { recursive: true });
    const cachePath = path.join(opts.cacheDir, `${opts.videoId}.json`);
    if (fs.existsSync(cachePath)) {
        fs.copyFileSync(cachePath, path.join(backupDir, `${opts.videoId}.json`));
    }
    fs.writeFileSync(cachePath, JSON.stringify(normalized, null, 2) + "\n", "utf-8");
    console.log(JSON.stringify({ videoId: opts.videoId, sourceFile: path.basename(best.file), summary, backupDir }, null, 2));
    } finally {
        // Clean up temp directory
        if (tmpDir) {
            try {
                fs.rmSync(tmpDir, { recursive: true, force: true });
            } catch (cleanupError) {
                console.error(`Warning: Failed to clean up temp directory ${tmpDir}:`, cleanupError);
            }
        }
    }
}

main().catch(error => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
});
