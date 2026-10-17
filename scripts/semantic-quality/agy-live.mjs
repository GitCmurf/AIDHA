// SPDX-License-Identifier: Apache-2.0
// Explicit manual evaluation of public fictional sources using native AGY.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, mkdir, mkdtemp, rm, writeFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { AGY_SELECTOR, createAgyClient, runAgyProcess, mustStopAgyEvaluation } from './agy-client.mjs';
import { recordCase } from './record-case.mjs';

const sha256 = bytes => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
const root = fileURLToPath(new URL('../../', import.meta.url));
const help = 'Manual public writer evaluation: node scripts/semantic-quality/agy-live.mjs --live NEW_OUTPUT_DIR [CASE_ID]';

export async function runAgyLive(args) {
  if (args.length === 1 && args[0] === '--help') { console.log(help); return; }
  if (args[0] !== '--live' || !args[1] || args.length > 3) throw new Error(help);
  const out = resolve(args[1]);
  try { await access(out); throw new Error('Output directory already exists; choose a fresh path'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const corpusBytes = await readFile(new URL('./cases.json', import.meta.url));
  const corpus = JSON.parse(corpusBytes);
  const cases = corpus.cases.filter(value => !args[2] || value.id === args[2]);
  if (!cases.length) throw new Error('Unknown case ID');
  // Build the local production miner before loading it; branch switches can stale transitive dist.
  execFileSync('pnpm', ['build:deps'], { cwd: root, stdio: 'inherit' });
  const { runSemanticCase } = await import('./run.mjs');
  const executable = process.env.AIDHA_SEMANTIC_AGY ?? 'agy';
  const cliVersion = execFileSync(executable, ['--version'], { encoding: 'utf8' }).trim();
  const revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  const trackedDiffSha256 = sha256(execFileSync('git', ['diff', 'HEAD', '--'], { cwd: root }));
  const dirty = Boolean(execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim());
  const executionSha256 = Object.fromEntries(await Promise.all(
    ['agy-live.mjs', 'agy-client.mjs', 'run.mjs', 'record-case.mjs'].map(async name =>
      [name, sha256(await readFile(new URL(name, import.meta.url)))])));
  const sourceSha256 = sha256(await readFile(resolve(root, 'packages/praecis/core/src/extract/distill/prompts.ts')));
  await mkdir(out);
  for (const testCase of cases) {
    const calls = [];
    const execute = async (cliArgs, input) => {
      const cwd = await mkdtemp(join(tmpdir(), 'aidha-agy-writer-'));
      const raw = await runAgyProcess({ executable, args: cliArgs, input, cwd });
      try { await rm(cwd, { recursive: true, force: true }); }
      catch (error) { raw.cleanupError = error instanceof Error ? error.message : String(error); }
      return raw;
    };
    const llm = createAgyClient({ model: AGY_SELECTOR, calls, execute });
    const provenance = { schemaVersion: 1, corpusSha256: sha256(corpusBytes),
      labelStatus: corpus.labelStatus, revision, sourceSha256, cliVersion, executionSha256,
      trackedDiffSha256, dirty, requestedSelector: AGY_SELECTOR,
      route: 'native AGY CLI; prompt-constrained JSON; no native schema parity or API parity',
      limitations: [
        'AGY --json-schema is available but not verified for this production schema; the host parser remains authoritative.',
        'AGY exposes tools in init even with plan/sandbox/disabled slash commands; observed tool/delegation steps fail the evaluation after the call.',
        'AGY cannot enforce production request.maxTokens; native context overhead and dollar cost are uncalibrated.',
      ] };
    const result = await recordCase({ caseId: testCase.id, calls, provenance,
      run: () => runSemanticCase({ testCase, llm, model: AGY_SELECTOR }),
      save: record => writeFile(resolve(out, `${testCase.id}.json`), `${JSON.stringify(record, null, 2)}\n`,
        { flag: 'wx', encoding: 'utf8' }) });
    console.log(JSON.stringify({ caseId: testCase.id, calls: calls.length,
      claims: result.report.claimsExtracted, failedClosed: result.report.sourceDistillation?.failedClosed }));
    if (mustStopAgyEvaluation(result.report, calls)) {
      throw new Error('Failed native call or failed-closed writer evaluation; inspect saved raw evidence before another case');
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runAgyLive(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1; });
}
