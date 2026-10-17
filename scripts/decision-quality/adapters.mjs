// SPDX-License-Identifier: Apache-2.0
import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { loadCorpora } from './run.mjs';
import { prepareDecisionPlan } from './plan.mjs';
import { normalizeNativeCaptures } from './capture.mjs';

const help = `Offline provider adapters (build workspace dependencies first)
  --plan OUTPUT
  --normalize-native PROVIDER TASK MODEL CAPTURES OUTPUT
  --help
PROVIDER: openai or openrouter; TASK: categorization or grounding.
Creates output exclusively. No live mode, HTTP transport or credential lookup.`;

export async function runAdapterCli(args) {
  if (args.length === 1 && args[0] === '--help') { console.log(help); return; }
  const corpora = await loadCorpora();
  let result;
  let destination;
  if (args.length === 2 && args[0] === '--plan') {
    result = prepareDecisionPlan(corpora);
    destination = args[1];
  } else if (args.length === 6 && args[0] === '--normalize-native') {
    const corpus = corpora[args[2]];
    if (!corpus) throw new Error('Unknown task; choose categorization or grounding');
    const captures = JSON.parse(await readFile(args[4], 'utf8'));
    result = normalizeNativeCaptures(corpus, args[1], args[3], captures);
    destination = args[5];
  } else throw new Error(help);
  await writeFile(destination, `${JSON.stringify(result, null, 2)}\n`, { flag: 'wx', encoding: 'utf8' });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runAdapterCli(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1; });
}
