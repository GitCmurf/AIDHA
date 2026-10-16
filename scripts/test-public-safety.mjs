#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const checker = fileURLToPath(new URL('./check-public-safety.mjs', import.meta.url));

function withTrackedFiles(paths, run, rootSuffix = '') {
    const temporaryDir = mkdtempSync(join(tmpdir(), 'aidha-public-paths-'));
    const dir = rootSuffix ? join(temporaryDir, `repo${rootSuffix}`) : temporaryDir;
    try {
        if (rootSuffix) mkdirSync(dir);
        execFileSync('git', ['init', '--quiet', dir]);
        for (const path of paths) {
            const absolutePath = join(dir, path);
            mkdirSync(dirname(absolutePath), { recursive: true });
            writeFileSync(absolutePath, 'synthetic fixture\n');
            execFileSync('git', ['-C', dir, 'add', '--force', '--', path]);
        }
        run(dir);
    } finally {
        rmSync(temporaryDir, { recursive: true, force: true });
    }
}

function check(cwd) {
    return spawnSync(process.execPath, [checker], { cwd, encoding: 'utf8' });
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
