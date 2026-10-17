import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { buildCategoryRequest, runKeywordBaseline } from './category.mjs';
import { buildGroundingRequest } from './grounding.mjs';
import { fingerprint, stampReceipt, scoreDecisions } from './quality.mjs';

export async function loadCorpora() {
  return Object.fromEntries(await Promise.all([
    ['categorization', 'category-cases.json'], ['grounding', 'grounding-cases.json'],
  ].map(async ([task, file]) => [task, JSON.parse(await readFile(new URL(file, import.meta.url), 'utf8'))])));
}

function requestBuilder(corpus) {
  return corpus.task === 'categorization'
    ? testCase => buildCategoryRequest(testCase, corpus.taxonomy)
    : buildGroundingRequest;
}

export function prepareRequests(corpora) {
  return { version: 1, tasks: Object.fromEntries(Object.entries(corpora).map(([task, corpus]) => {
    const build = requestBuilder(corpus);
    return [task, { corpusHash: fingerprint(corpus), requests: corpus.cases.map(c => {
      const request = build(c);
      return { caseId: c.id, requestHash: fingerprint(request), request };
    }) }];
  })) };
}

export async function collectKeywordBaseline(corpus) {
  // This module defines KeywordTaxonomyClassifier, normalizeForMatch and matchNeedle.
  // The digest identifies that classifier module, not the entire runtime/dependency stack.
  const classifierModule = await readFile(new URL('../../packages/praecis/core/dist/pipeline/services.js', import.meta.url));
  const classifierModuleHash = `sha256:${createHash('sha256').update(classifierModule).digest('hex')}`;
  const rows = await runKeywordBaseline(corpus);
  const caseById = new Map(corpus.cases.map(c => [c.id, c]));
  const receipts = rows.map(row => stampReceipt(corpus, caseById.get(row.caseId), row.request, {
    requestedModel: 'KeywordTaxonomyClassifier', resolvedModel: `praecis-keyword-classifier@${classifierModuleHash}`,
    endpoint: null, evidenceKind: 'keyword-baseline', status: 'ok',
    answers: corpus.taxonomy.tags.map(tag => ({ questionId: tag.id,
      choice: row.assignedTags.includes(tag.id) ? 'applies' : 'not_applicable' })),
    rawReply: { resource: { ...row.resource, metadata: { ...row.resource.metadata,
      // Publish the observations needed for scoring; the unprojected runtime result
      // retains the redundant vocabulary fingerprint flagged by secret scanning.
      taxonomyAssignments: (row.resource.metadata.taxonomyAssignments ?? []).map(assignment =>
        Object.fromEntries(Object.entries(assignment).filter(([key]) => key !== 'taxonomyVersion'))),
    } }, omittedFields: ['resource.metadata.taxonomyAssignments[].taxonomyVersion'] },
    usage: null, costUsd: null, durationMs: null,
  }));
  return scoreDecisions(corpus, requestBuilder(corpus), receipts);
}

const help = `Offline decision quality checkpoint (build workspace dependencies first)
  --baseline OUTPUT             Run actual keyword classification and score stored assignments
  --requests OUTPUT             Export model-visible requests for both frozen public task sets
  --replay TASK RECEIPTS OUTPUT  Score normalized saved receipts; TASK is categorization or grounding
  --help                        Show this usage
Outputs are created exclusively. No command invokes a model or network service.`;

export async function runCli(args) {
  if (args.length === 1 && args[0] === '--help') { console.log(help); return; }
  const corpora = await loadCorpora();
  let output;
  let destination;
  if (args[0] === '--baseline' && args.length === 2) {
    output = await collectKeywordBaseline(corpora.categorization);
    destination = args[1];
  } else if (args[0] === '--requests' && args.length === 2) {
    output = prepareRequests(corpora);
    destination = args[1];
  } else if (args[0] === '--replay' && args.length === 4) {
    const corpus = corpora[args[1]];
    if (!corpus) throw new Error('Unknown task; choose categorization or grounding');
    const receipts = JSON.parse(await readFile(args[2], 'utf8'));
    output = scoreDecisions(corpus, requestBuilder(corpus), receipts);
    destination = args[3];
  } else throw new Error(help);
  await writeFile(destination, `${JSON.stringify(output, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1; });
}
