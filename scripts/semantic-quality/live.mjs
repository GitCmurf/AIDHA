// SPDX-License-Identifier: Apache-2.0
// Explicit, manual evaluation using an existing native Claude subscription session.
import { spawn, execFileSync } from 'node:child_process';
import { readFile, mkdir, writeFile, access } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createNativeClient } from './native-client.mjs';
import { recordCase } from './record-case.mjs';

const args = process.argv.slice(2);
if (args[0] !== '--live' || !args[1] || args.length > 3) {
  throw new Error('Usage: node scripts/semantic-quality/live.mjs --live OUTPUT_DIR [CASE_ID]');
}
const corpusBytes = await readFile(new URL('./cases.json', import.meta.url));
const corpus = JSON.parse(corpusBytes);
const cases = corpus.cases.filter(value => !args[2] || value.id === args[2]);
if (!cases.length) throw new Error('Unknown case ID');
const out = resolve(args[1]);
await mkdir(out, { recursive: true });
for (const value of cases) {
  try { await access(resolve(out, `${value.id}.json`)); }
  catch (error) { if (error.code === 'ENOENT') continue; throw error; }
  throw new Error('Output already exists; use a fresh output directory');
}
const root = fileURLToPath(new URL('../../', import.meta.url));
execFileSync('pnpm', ['build:deps'], { cwd: root, stdio: 'inherit' });
const { runSemanticCase } = await import('./run.mjs');
const executable = process.env.AIDHA_SEMANTIC_CLAUDE ?? 'claude';
const cliVersion = execFileSync(executable, ['--version'], { encoding: 'utf8' }).trim();
const revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
const sourceSha256 = createHash('sha256').update(await readFile(resolve(root, 'packages/praecis/core/src/extract/distill/prompts.ts'))).digest('hex');
const executionSha256 = Object.fromEntries(await Promise.all(['live.mjs', 'run.mjs', 'native-client.mjs', 'record-case.mjs'].map(async name => [name, createHash('sha256').update(await readFile(new URL(name, import.meta.url))).digest('hex')])));
const trackedDiffSha256 = createHash('sha256').update(execFileSync('git', ['diff', 'HEAD', '--'], { cwd: root })).digest('hex');
const dirty = Boolean(execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim());
const model = 'claude-sonnet-5-5';
const scratch = resolve(out, 'native-cli');
await mkdir(scratch, { recursive: true });
for (const testCase of cases) {
  const calls = [];
  const execute = async (cliArgs, user) => {
    const result = await new Promise((res, reject) => {
      const child = spawn(executable, cliArgs, { cwd: scratch, timeout: 120000, stdio: ['pipe', 'pipe', 'pipe'] });
      let stdout = ''; let stderr = '';
      child.stdout.on('data', bytes => { stdout += bytes; });
      child.stderr.on('data', bytes => { stderr += bytes; });
      child.on('error', reject);
      child.on('close', code => code === 0 ? res({ stdout, stderr }) : reject(new Error(`Native CLI exited ${code}: ${stderr.slice(0, 600)}`)));
      child.stdin.on('error', () => {}); // A failed child may close stdin before its failure event.
      child.stdin.end(user);
    });
    return JSON.parse(result.stdout);
  };
  const llm = createNativeClient({ model, calls, execute });
  const provenance = { schemaVersion: 1, corpusSha256: createHash('sha256').update(corpusBytes).digest('hex'),
    labelStatus: corpus.labelStatus, revision, sourceSha256, cliVersion, executionSha256, trackedDiffSha256, dirty, model,
    route: 'native Claude subscription CLI; no tools; not API-provider parity',
    limitations: ['Native --json-schema carries responseFormat; the CLI does not implement request.maxTokens.',
      'Resolved model usage is recorded; a single run is not a statistical quality claim.'] };
  const result = await recordCase({ caseId: testCase.id, calls, provenance,
    run: () => runSemanticCase({ testCase, llm, model }),
    save: record => writeFile(resolve(out, `${testCase.id}.json`), JSON.stringify(record, null, 2) + '\n', { flag: 'wx' }) });
  console.log(JSON.stringify({ caseId: testCase.id, calls: calls.length, claims: result.report.claimsExtracted,
    failedClosed: result.report.sourceDistillation?.failedClosed }));
  if (result.report.sourceDistillation?.failedClosed) throw new Error('Failed-closed evaluation; inspect saved evidence before proceeding');
}
