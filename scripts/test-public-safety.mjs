#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const checker = fileURLToPath(new URL('./check-public-safety.mjs', import.meta.url));
const testScript = fileURLToPath(import.meta.url);
const repositoryLocalGitVariables = execFileSync('git', ['rev-parse', '--local-env-vars'], {
    cwd: tmpdir(),
    env: { PATH: process.env.PATH ?? '' },
    encoding: 'utf8',
}).split('\n').filter(Boolean);

function isolatedGitEnv() {
    // Fixtures must not borrow the caller's repository, index, or object storage.
    // Git supplies the repository-local variable list for this installation.
    const env = { ...process.env };
    for (const name of [
        ...repositoryLocalGitVariables,
        'GIT_NAMESPACE',
        'GIT_CEILING_DIRECTORIES',
        'GIT_DISCOVERY_ACROSS_FILESYSTEM',
    ]) {
        delete env[name];
    }
    return env;
}

function withTrackedFiles(paths, run, rootSuffix = '') {
    const temporaryDir = mkdtempSync(join(tmpdir(), 'aidha-public-paths-'));
    const dir = rootSuffix ? join(temporaryDir, `repo${rootSuffix}`) : temporaryDir;
    const env = isolatedGitEnv();
    try {
        if (rootSuffix) mkdirSync(dir);
        execFileSync('git', ['init', '--quiet', dir], { env });
        for (const path of paths) {
            const absolutePath = join(dir, path);
            mkdirSync(dirname(absolutePath), { recursive: true });
            writeFileSync(absolutePath, 'synthetic fixture\n');
            execFileSync('git', ['-C', dir, 'add', '--force', '--', path], { env });
        }
        run(dir);
    } finally {
        rmSync(temporaryDir, { recursive: true, force: true });
    }
}

function check(cwd) {
    return spawnSync(process.execPath, [checker], { cwd, env: isolatedGitEnv(), encoding: 'utf8' });
}

test('allows tracked synthetic acceptance artifacts', () => {
    withTrackedFiles([
        '.env.example',
        '.aidha/config.yaml.example',
        '.config/aidha/config.yaml.example',
        'docs/55-testing/acceptance-run-20260602/mock-transcript.json',
        'docs/55-testing/testing-006-viable-prototype-pilot-evidence-template.md',
    ], (cwd) => {
        const result = check(cwd);
        assert.equal(result.status, 0, result.stderr);
        assert.match(result.stdout, /no tracked paths matched configured private\/local patterns/u);
    });
});

test('rejects tracked private pilot artifacts and local configuration', () => {
    withTrackedFiles([
        'docs/55-testing/pilot-run-20260602/evidence.md',
        'Personal/notes.md',
        'PERSONAL/other-notes.md',
        '.aidha/config.yaml',
        '.aidha/config.yaml.old',
        '.aidha/config.yaml.old.example',
        '.config/aidha/config.yaml',
        '.env.production',
        '.ENV.production',
        'env/service-token.txt',
        'ENV/account.txt',
        'keys/service.KEY',
    ], (cwd) => {
        const result = check(cwd);
        assert.equal(result.status, 1, result.stderr);
        for (const path of [
            'pilot-run-20260602/evidence.md',
            'Personal/notes.md',
            'PERSONAL/other-notes.md',
            '.aidha/config.yaml',
            '.aidha/config.yaml.old',
            '.aidha/config.yaml.old.example',
            '.config/aidha/config.yaml',
            '.env.production',
            '.ENV.production',
            'env/service-token.txt',
            'ENV/account.txt',
            'keys/service.KEY',
        ]) {
            assert.ok(result.stderr.includes(path), `missed tracked path: ${path}\n${result.stderr}`);
        }
    });
});

test('checks root paths when invoked from a nested directory', () => {
    for (const rootSuffix of ['', '\n']) {
        withTrackedFiles(['Personal/notes.md', 'scripts/safe.txt'], (root) => {
            const result = check(join(root, 'scripts'));
            assert.equal(result.status, 1, result.stderr);
            assert.match(result.stderr, /Personal\/notes\.md/u);
        }, rootSuffix);
    }
});

test('retains every original private path category after case normalization', () => {
    const privatePaths = [
        '__Local__Do_Not_Commit/pilot.md',
        '__LOCAL__DO_NOT_COMMIT/pilot.md',
        'CMF/private.md',
        'CMF-project/private.md',
        'Secrets/secret.txt',
        'credentials/token.txt',
        'creds/token.txt',
        '.aws/credentials',
        '.ssh/id_rsa',
        'out/export.json',
        'testdata/youtube_local/raw.json',
        'testdata/nonredistributable/source.pdf',
        '.env',
        'fixtures/cookies.txt',
        'fixtures/credentials.json',
        'keys/model.secret',
        'keys/cert.pem',
        'keys/service.p12',
        'keys/certificate.pfx',
    ];
    withTrackedFiles(privatePaths, (cwd) => {
        const result = check(cwd);
        assert.equal(result.status, 1, result.stderr);
        for (const path of privatePaths) {
            assert.ok(result.stderr.includes(path), `missed tracked path: ${path}\n${result.stderr}`);
        }
    });
});

test('rejects prohibited paths containing a newline', () => {
    const path = 'docs/55-testing/pilot-run-20260602/notes\nprivate.md';
    withTrackedFiles([path], (cwd) => {
        const result = check(cwd);
        assert.equal(result.status, 1, result.stderr);
        assert.match(result.stderr, /private pilot evidence packet/u);
        assert.ok(result.stderr.includes(JSON.stringify(path)), result.stderr);
    });
});

test('fails closed if Git cannot list tracked paths', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'aidha-public-paths-no-git-'));
    try {
        const result = check(cwd);
        assert.notEqual(result.status, 0);
    } finally {
        rmSync(cwd, { recursive: true, force: true });
    }
});

test('keeps a disposable caller alternate index intact under inherited Git state', () => {
    const temporaryDir = mkdtempSync(join(tmpdir(), 'aidha-public-caller-index-'));
    const callerRepo = join(temporaryDir, 'caller');
    const alternateIndex = join(temporaryDir, 'caller-alternate.index');
    const fixtureEnv = isolatedGitEnv();
    try {
        mkdirSync(callerRepo);
        execFileSync('git', ['init', '--quiet', callerRepo], { env: fixtureEnv });
        writeFileSync(join(callerRepo, 'baseline.txt'), 'disposable caller baseline\n');
        execFileSync('git', ['-C', callerRepo, 'add', '--', 'baseline.txt'], { env: fixtureEnv });
        copyFileSync(join(callerRepo, '.git', 'index'), alternateIndex);

        const indexEnv = { ...fixtureEnv, GIT_INDEX_FILE: alternateIndex };
        const stagedPaths = () => execFileSync('git', ['-C', callerRepo, 'ls-files', '-z'], {
            env: indexEnv,
            encoding: 'utf8',
        });
        const beforeBytes = readFileSync(alternateIndex);
        const beforePaths = stagedPaths();
        assert.equal(beforePaths, 'baseline.txt\0');

        const result = spawnSync(process.execPath, [
            '--test',
            '--test-name-pattern=allows tracked synthetic acceptance artifacts',
            testScript,
        ], {
            cwd: callerRepo,
            env: indexEnv,
            encoding: 'utf8',
        });

        assert.equal(result.status, 0, result.stderr);
        assert.deepEqual(readFileSync(alternateIndex), beforeBytes, 'caller alternate index bytes changed');
        assert.equal(stagedPaths(), beforePaths, 'caller staged paths changed');
    } finally {
        rmSync(temporaryDir, { recursive: true, force: true });
    }
});
