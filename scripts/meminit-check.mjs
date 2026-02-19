#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import process from 'node:process';

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

if (patterns.length === 0) {
    runAndExit('meminit', ['check', '--root', '.']);
}

const result = spawnSync(
    'meminit',
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
    if (!violation || typeof violation.file !== 'string') return false;
    const filePath = violation.file.replace(/\\/g, '/');
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
    // eslint-disable-next-line no-console
    console.log(
        `[${violation.severity ?? 'error'}] ${violation.file}: ${violation.rule} ${violation.message}`,
    );
}

process.exit(1);
