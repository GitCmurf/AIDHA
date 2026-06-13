#!/usr/bin/env node
// scripts/dev/compare-extraction.mjs
// TEMPORARY (AIDHA-TASK-012): runs the same source through both extraction
// paths and prints a side-by-side summary. Deleted with the legacy path in Task 14.
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const url = process.argv[2];
if (!url) {
  console.error('usage: node scripts/dev/compare-extraction.mjs <youtube-url>');
  process.exit(1);
}

// Resolve the repo-local aidha helper (scripts/aidha) relative to this file
// (scripts/dev/compare-extraction.mjs → scripts/aidha).
const aidha = join(dirname(fileURLToPath(import.meta.url)), '..', 'aidha');

function run(envPath) {
  const out = execFileSync(aidha, ['ingest', 'youtube', '--url', url, '--json'], {
    env: { ...process.env, AIDHA_EXTRACTION_PATH: envPath },
    encoding: 'utf-8',
    maxBuffer: 64 * 1024 * 1024,
  });
  return JSON.parse(out);
}

const legacy = run('chunk-mining');
const distill = run('distillation');

const summarize = (report) => ({
  claims: report.claimsExtracted,
  reviewable: report.qualitySummary?.reviewable,
  rejected: report.qualitySummary?.rejected,
  supportingUnits: report.supportingUnits?.length ?? 'n/a',
  theses: report.sourceDistillation?.theses?.length ?? 'n/a',
  coveragePercent: report.sourceDistillation?.coverage?.excerptsCitedPercent ?? 'n/a',
});

console.table({ 'chunk-mining': summarize(legacy), distillation: summarize(distill) });
console.log('\nDistillation claims:');
for (const claim of distill.claims ?? []) {
  const kind = claim.type ? `[${claim.type}] ` : '';
  console.log(`- ${kind}${claim.text}`);
}
console.log('\nLegacy claims:');
for (const claim of legacy.claims ?? []) console.log(`- ${claim.text}`);
