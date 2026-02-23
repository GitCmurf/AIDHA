#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { accessSync, constants } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';

function resolveMeminitCommand() {
    const localMeminit = join(process.cwd(), '.venv', 'bin', 'meminit');
    try {
        accessSync(localMeminit, constants.X_OK);
        return localMeminit;
    } catch {
        return 'meminit';
    }
}

function runAndExit(command, args) {
    const result = spawnSync(command, args, { stdio: 'inherit' });
    process.exit(typeof result.status === 'number' ? result.status : 1);
}

function globToRegex(glob) {
    const normalized = glob.replace(/\\/g, '/').replace(/^\.\//, '');
    const escaped = normalized.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    const withWildcards = escaped
        .replace(/\\\*\\\*/g, '.*')
        .replace(/\\\*/g, '[^/]*')
        .replace(/\\\?/g, '.');
    return new RegExp(`^${withWildcards}$`);
}

const patterns = process.argv.slice(2);
const meminitCommand = resolveMeminitCommand();

if (patterns.length === 0) {
    runAndExit(meminitCommand, ['check', '--root', '.']);
}

const result = spawnSync(
    meminitCommand,
    ['check', '--root', '.', '--format', 'json'],
    { encoding: 'utf-8' },
);

if (result.error) {
    // eslint-disable-next-line no-console
    console.error(`meminit check failed: ${result.error.message}`);
    process.exit(2);
}

const output = (result.stdout ?? '').trim();
if (!output) {
    // eslint-disable-next-line no-console
    console.error('meminit check returned empty output.');
    process.exit(2);
}

let data;
try {
    data = JSON.parse(output);
} catch (error) {
    // eslint-disable-next-line no-console
    console.error('meminit check returned non-JSON output.');
    if (result.stderr) {
        // eslint-disable-next-line no-console
        console.error(result.stderr);
    }
    process.exit(2);
}

const regexes = patterns.map(globToRegex);
const violations = Array.isArray(data.violations) ? data.violations : [];
const filtered = violations.filter((violation) => {
    if (!violation) return false;
    const rawPath = violation.path ?? violation.file;
    if (typeof rawPath !== 'string') return false;
    const filePath = rawPath.replace(/\\/g, '/');
    return regexes.some((regex) => regex.test(filePath));
});

if (filtered.length === 0) {
    // eslint-disable-next-line no-console
    console.log('Meminit check (filtered): no violations for provided paths.');
    process.exit(0);
}

// eslint-disable-next-line no-console
console.log('Meminit check (filtered):');
for (const violation of filtered) {
    const path = violation.path ?? violation.file ?? '<unknown>';
    // eslint-disable-next-line no-console
    console.log(
        `[${violation.severity ?? 'error'}] ${path}: ${violation.rule} ${violation.message}`,
    );
}

process.exit(1);
