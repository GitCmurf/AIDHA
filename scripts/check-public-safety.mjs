#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";

const FORBIDDEN_SEGMENTS = new Map([
    ["__Local__Do_Not_Commit", "local-only artifact directory"],
    ["Personal", "personal artifact directory"],
    ["personal", "personal artifact directory"],
    ["CMF", "personal artifact directory"],
    ["Secrets", "secrets directory"],
    ["secrets", "secrets directory"],
    ["Secret", "secrets directory"],
    ["credentials", "credentials directory"],
    ["creds", "credentials directory"],
    [".aws", "cloud credentials directory"],
    [".ssh", "SSH credentials directory"],
    ["out", "generated output directory"],
]);

const FORBIDDEN_PATH_PREFIXES = new Map([
    ["testdata/youtube_local/", "local YouTube test data"],
    ["testdata/nonredistributable/", "non-redistributable test data"],
    ["docs/55-testing/pilot-run-", "private pilot evidence packet"],
]);

const FORBIDDEN_BASENAMES = new Map([
    [".env", "environment secret file"],
    [".env.local", "local environment secret file"],
    ["cookies.txt", "browser cookie export"],
    ["cookie.txt", "browser cookie export"],
    ["credentials.json", "credentials file"],
]);

const FORBIDDEN_SUFFIXES = new Map([
    [".secret", "secret-bearing file suffix"],
    [".key", "key-bearing file suffix"],
    [".pem", "private key/certificate file suffix"],
    [".p12", "private key/certificate file suffix"],
    [".pfx", "private key/certificate file suffix"],
]);

export function classifyTrackedPath(filePath) {
    const normalizedPath = filePath.replaceAll("\\", "/");
    const segments = normalizedPath.split("/");
    const basename = segments.at(-1) ?? normalizedPath;

    for (const [prefix, reason] of FORBIDDEN_PATH_PREFIXES) {
        if (normalizedPath.startsWith(prefix)) {
            return reason;
        }
    }

    for (const segment of segments) {
        const reason = FORBIDDEN_SEGMENTS.get(segment);
        if (reason) {
            return reason;
        }
    }

    const exactReason = FORBIDDEN_BASENAMES.get(basename);
    if (exactReason) {
        return exactReason;
    }

    for (const [suffix, reason] of FORBIDDEN_SUFFIXES) {
        if (basename.endsWith(suffix)) {
            return reason;
        }
    }

    return null;
}

export function findUnsafeTrackedPaths(paths) {
    return paths
        .map((filePath) => ({ filePath, reason: classifyTrackedPath(filePath) }))
        .filter(({ reason }) => reason !== null);
}

function getTrackedPaths() {
    let output = "";
    try {
        output = execFileSync("git", ["ls-files"], { encoding: "utf8", maxBuffer: 10 * 1024 * 1024 });
    } catch (error) {
        if (typeof error.stdout !== "string" || error.stdout.length === 0) {
            throw error;
        }
        output = error.stdout;
    }
    return output.split(/\r?\n/u).filter(Boolean);
}

function runSelfTest() {
    const safePaths = [
        "docs/50-runbooks/runbook-013-private-pilot-safety.md",
        "docs/55-testing/acceptance-run-20260531/command-transcript.json",
        "packages/praecis/cli/tests/cli.test.ts",
        "scripts/check-public-safety.mjs",
    ];

    const unsafePaths = [
        ".env",
        "Personal/pilot-notes.md",
        "CMF/private-pilot.md",
        "docs/55-testing/pilot-run-20260602/evidence.md",
        "testdata/youtube_local/raw.json",
        "testdata/nonredistributable/source.pdf",
        "out/graph.jsonld",
        "creds/api.json",
        "fixtures/cookies.txt",
        "keys/service-account.key",
    ];

    assert.deepEqual(findUnsafeTrackedPaths(safePaths), []);
    assert.equal(findUnsafeTrackedPaths(unsafePaths).length, unsafePaths.length);
    console.log("Public safety path self-test passed.");
}

function main() {
    if (process.argv.includes("--self-test")) {
        runSelfTest();
        return;
    }

    const unsafePaths = findUnsafeTrackedPaths(getTrackedPaths());
    if (unsafePaths.length === 0) {
        console.log("Public safety path check passed: no tracked private/local artifact paths.");
        return;
    }

    console.error("Public safety path check failed: tracked private/local artifact paths found.");
    for (const { filePath, reason } of unsafePaths) {
        console.error(`- ${filePath} (${reason})`);
    }
    console.error("");
    console.error("Move private files outside the repo or into an ignored local-only directory.");
    console.error("If a file was only staged by mistake, unstage it with: git restore --staged <path>");
    process.exitCode = 1;
}

main();
