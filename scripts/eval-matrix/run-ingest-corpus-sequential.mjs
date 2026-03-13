#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { buildSingleVideoIngestArgs, selectPendingVideoIds, transcriptPath } from "./ingest-runner-lib.mjs";

function isValidVideoId(id) {
    return typeof id === "string" && /^[a-zA-Z0-9_-]{1,100}$/.test(id) && !id.includes("..");
}

function usage() {
    console.error("Usage: node scripts/eval-matrix/run-ingest-corpus-sequential.mjs --corpus <path> [--cache-dir <path>] [--db <path>] [--config <path>] [--request-delay-seconds <n>] [--failure-delay-seconds <n>] [--max-retries <n>] [--video-id <id>]");
    process.exit(1);
}

function parseArgs(argv) {
    const options = {
        corpusPath: "",
        cacheDir: "out/eval-matrix/transcripts",
        dbPath: "out/eval-matrix/aidha-eval.sqlite",
        configPath: ".aidha/config.yaml",
        requestDelaySeconds: 20,
        failureDelaySeconds: 90,
        maxRetries: 1,
        videoId: "",
    };

    for (let i = 0; i < argv.length; i += 1) {
        const arg = argv[i];
        const value = argv[i + 1];
        switch (arg) {
            case "--corpus":
                options.corpusPath = value || "";
                i += 1;
                break;
            case "--cache-dir":
                options.cacheDir = value || "";
                i += 1;
                break;
            case "--db":
                options.dbPath = value || "";
                i += 1;
                break;
            case "--config":
                options.configPath = value || "";
                i += 1;
                break;
            case "--request-delay-seconds":
                options.requestDelaySeconds = Number.parseInt(value || "", 10);
                i += 1;
                break;
            case "--failure-delay-seconds":
                options.failureDelaySeconds = Number.parseInt(value || "", 10);
                i += 1;
                break;
            case "--max-retries":
                options.maxRetries = Number.parseInt(value || "", 10);
                i += 1;
                break;
            case "--video-id":
                options.videoId = value || "";
                i += 1;
                break;
            case "--help":
                usage();
                break;
            default:
                throw new Error(`Unknown option: ${arg}`);
        }
    }

    if (!options.corpusPath) {
        throw new Error("--corpus is required");
    }
    if (!Number.isInteger(options.requestDelaySeconds) || options.requestDelaySeconds < 0) {
        throw new Error("--request-delay-seconds must be a non-negative integer");
    }
    if (!Number.isInteger(options.failureDelaySeconds) || options.failureDelaySeconds < 0) {
        throw new Error("--failure-delay-seconds must be a non-negative integer");
    }
    if (!Number.isInteger(options.maxRetries) || options.maxRetries < 0) {
        throw new Error("--max-retries must be a non-negative integer");
    }

    return options;
}

function transcriptHasSegments(cachePath) {
    if (!fs.existsSync(cachePath)) return false;
    try {
        const payload = JSON.parse(fs.readFileSync(cachePath, "utf-8"));
        return Array.isArray(payload.segments) && payload.segments.length > 0;
    } catch {
        return false;
    }
}

function sleep(seconds, label) {
    if (seconds <= 0) return;
    console.log(`${label} ${seconds}s...`);
    spawnSync("sleep", [String(seconds)], { stdio: "inherit" });
}

function runSingleVideo(options, videoId) {
    const args = buildSingleVideoIngestArgs({
        corpusPath: options.corpusPath,
        cacheDir: options.cacheDir,
        dbPath: options.dbPath,
        configPath: path.resolve(options.configPath),
    }, videoId);

    return spawnSync("bash", args, {
        stdio: "inherit",
        cwd: process.cwd(),
    });
}

function main() {
    const options = parseArgs(process.argv.slice(2));
    const corpus = JSON.parse(fs.readFileSync(options.corpusPath, "utf-8"));
    for (const entry of corpus) {
        if (!isValidVideoId(entry.videoId)) {
            throw new Error(`Invalid videoId in corpus: ${JSON.stringify(entry.videoId)}`);
        }
    }
    const cachedVideoIds = new Set(
        corpus
            .map(entry => entry.videoId)
            .filter(videoId => transcriptHasSegments(transcriptPath(options.cacheDir, videoId))),
    );
    const pendingVideoIds = selectPendingVideoIds(corpus, cachedVideoIds, options.videoId);

    if (pendingVideoIds.length === 0) {
        console.log("No pending videos to ingest.");
        return;
    }

    console.log(`Sequential ingest plan: ${pendingVideoIds.length} video(s) pending.`);
    const failures = [];

    for (let index = 0; index < pendingVideoIds.length; index += 1) {
        const videoId = pendingVideoIds[index];
        let succeeded = false;

        for (let attempt = 0; attempt <= options.maxRetries; attempt += 1) {
            const humanAttempt = attempt + 1;
            const maxAttempts = options.maxRetries + 1;
            console.log(`[${index + 1}/${pendingVideoIds.length}] ${videoId} attempt ${humanAttempt}/${maxAttempts}`);

            const result = runSingleVideo(options, videoId);
            if ((result.status ?? 1) === 0) {
                succeeded = true;
                break;
            }

            if (attempt < options.maxRetries) {
                sleep(options.failureDelaySeconds, "Cooling down before retry for");
            }
        }

        if (!succeeded) {
            failures.push(videoId);
            continue;
        }

        if (index < pendingVideoIds.length - 1) {
            sleep(options.requestDelaySeconds, "Waiting before next video for");
        }
    }

    if (failures.length > 0) {
        console.error(`Sequential ingest completed with failures: ${failures.join(", ")}`);
        process.exit(1);
    }

    console.log("Sequential ingest completed successfully.");
}

try {
    main();
} catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
}
