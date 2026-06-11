import assert from "node:assert/strict";
import { chmod, copyFile, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";

const repoRoot = resolve(import.meta.dirname, "..");
const wrapperSource = join(repoRoot, "scripts", "aidha");

async function createTempRepo({ withFakeCli = false } = {}) {
    const root = await mkdtemp(join(tmpdir(), "aidha-wrapper-test-"));
    const scriptsDir = join(root, "scripts");
    const cliDir = join(root, "packages", "praecis", "cli", "dist");
    const outputFile = join(root, "fake-cli-output.json");
    await mkdir(scriptsDir, { recursive: true });
    await copyFile(wrapperSource, join(scriptsDir, "aidha"));
    await chmod(join(scriptsDir, "aidha"), 0o755);

    if (withFakeCli) {
        await mkdir(cliDir, { recursive: true });
        await writeFile(
            join(cliDir, "cli.js"),
            [
                "const { writeFileSync } = require('node:fs');",
                "writeFileSync(process.env.AIDHA_FAKE_CLI_OUTPUT, JSON.stringify({ argv: process.argv.slice(2) }));",
                "",
            ].join("\n"),
            "utf8"
        );
    }

    return {
        root,
        wrapper: join(scriptsDir, "aidha"),
        outputFile,
    };
}

function runWrapper(wrapper, args = [], options = {}) {
    return new Promise((resolveRun, rejectRun) => {
        const child = spawn(wrapper, args, {
            cwd: options.cwd,
            env: {
                ...process.env,
                PATH: process.env.PATH ?? "",
                ...(options.env ?? {}),
            },
        });
        let stdout = "";
        let stderr = "";
        child.stdout.setEncoding("utf8");
        child.stderr.setEncoding("utf8");
        child.stdout.on("data", chunk => {
            stdout += chunk;
        });
        child.stderr.on("data", chunk => {
            stderr += chunk;
        });
        child.on("error", rejectRun);
        child.on("close", status => {
            resolveRun({ status, stdout, stderr });
        });
    });
}

test("scripts/aidha reports missing built CLI", async () => {
    const { wrapper } = await createTempRepo();

    const result = await runWrapper(wrapper);

    assert.equal(result.status, 1);
    assert.match(result.stderr, /AIDHA CLI not built at .+packages\/praecis\/cli\/dist\/cli\.js/);
    assert.match(result.stderr, /Run: pnpm --filter @aidha\/praecis-cli build/);
});

test("scripts/aidha forwards arguments to the Node CLI entrypoint", async () => {
    const { wrapper, outputFile } = await createTempRepo({ withFakeCli: true });

    const result = await runWrapper(wrapper, ["config", "explain", "llm.model", "--json"], {
        env: { AIDHA_FAKE_CLI_OUTPUT: outputFile },
    });

    assert.equal(result.status, 0);
    assert.deepEqual(JSON.parse(await readFile(outputFile, "utf8")), {
        argv: ["config", "explain", "llm.model", "--json"],
    });
});

test("scripts/aidha resolves the repo root from the script path", async () => {
    const { wrapper, outputFile } = await createTempRepo({ withFakeCli: true });
    const cwd = await mkdtemp(join(tmpdir(), "aidha-wrapper-cwd-"));

    const result = await runWrapper(wrapper, ["--version"], {
        cwd,
        env: { AIDHA_FAKE_CLI_OUTPUT: outputFile },
    });

    assert.equal(result.status, 0);
    assert.deepEqual(JSON.parse(await readFile(outputFile, "utf8")), {
        argv: ["--version"],
    });
});
