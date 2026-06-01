#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 Colin Farmer (GitCmurf)

import { access, mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { homedir, tmpdir } from 'node:os';
import { format } from 'node:util';
import { fileURLToPath } from 'node:url';
import { SQLiteStore } from '../../packages/reconditum/dist/index.js';
import { runCli } from '../../packages/praecis/cli/dist/index.js';

const repoRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
process.chdir(repoRoot);

const requestedRunDate = process.env.AIDHA_ACCEPTANCE_DATE ?? new Date().toISOString().slice(0, 10);
const runDateIso = /^\d{8}$/.test(requestedRunDate)
  ? `${requestedRunDate.slice(0, 4)}-${requestedRunDate.slice(4, 6)}-${requestedRunDate.slice(6, 8)}`
  : requestedRunDate.slice(0, 10);
const runDate = runDateIso.replaceAll('-', '');
const packetRelativeDir = join('docs', '55-testing', `acceptance-run-${runDate}`);
const packetDir = join(repoRoot, packetRelativeDir);
const pdfFixtureRelativePath = join(packetRelativeDir, 'fixture-prototype.pdf');
const pdfFixturePath = join(repoRoot, pdfFixtureRelativePath);
const linkedInPaste = [
  'Activation planning converts captured knowledge into concrete next actions.',
  'Project re-entry should keep task provenance tied back to claims and sources.',
].join(' ');

await mkdir(packetDir, { recursive: true });
await writeFile(pdfFixturePath, [
  'Project re-entry needs task provenance back to claims and sources.',
  'Activation evidence should be reusable without reopening the original document.',
].join('\f'), 'utf-8');

async function pathExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function writeConfig(configPath, dbPath) {
  await writeFile(configPath, [
    'config_version: 1',
    'default_profile: local',
    'profiles:',
    '  local:',
    `    db: ${JSON.stringify(dbPath)}`,
    '    extraction:',
    '      max_claims: 4',
    '      chunk_minutes: 5',
    '      max_chunks: 4',
    '      prompt_version: acceptance-v1',
    '    editor:',
    '      version: v2',
    '      min_words: 1',
    '      min_chars: 1',
    '      min_windows: 1',
    '',
  ].join('\n'), 'utf-8');
}

function redactVolatileOutput(value) {
  return value
    .replaceAll(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/g, '<timestamp>')
    .replaceAll(/\(node:\d+\)/g, '(node:<pid>)');
}

async function capture(args, configPath) {
  const logs = [];
  const errors = [];
  const originalLog = console.log;
  const originalError = console.error;
  const originalStderrWrite = process.stderr.write.bind(process.stderr);
  console.log = (...values) => logs.push(format(...values));
  console.error = (...values) => errors.push(format(...values));
  process.stderr.write = (chunk, encoding, callback) => {
    errors.push(String(chunk).trimEnd());
    const done = typeof encoding === 'function' ? encoding : callback;
    if (typeof done === 'function') done();
    return true;
  };
  try {
    const code = await runCli([...args, '--config', configPath]);
    return {
      args,
      code,
      stdout: redactVolatileOutput(logs.join('\n')),
      stderr: redactVolatileOutput(errors.filter(Boolean).join('\n')),
    };
  } finally {
    console.log = originalLog;
    console.error = originalError;
    process.stderr.write = originalStderrWrite;
  }
}

async function runScenario({ writeArtifacts }) {
  const workDir = await mkdtemp(join(tmpdir(), 'aidha-viable-prototype-'));
  const dbPath = join(workDir, 'activation.sqlite');
  const configPath = join(workDir, 'aidha.config.yaml');
  const graphExportOut = writeArtifacts
    ? join(packetRelativeDir, 'graph-export.jsonld')
    : join(workDir, 'graph-export.jsonld');
  await writeConfig(configPath, dbPath);

  const transcript = [];
  transcript.push(await capture(['ingest', 'pdf', '--file', pdfFixtureRelativePath, '--mock-llm', '--json'], configPath));
  transcript.push(await capture([
    'ingest',
    'linkedin',
    '--paste',
    linkedInPaste,
    '--url',
    'https://linkedin.example.test/posts/activation-prototype',
    '--mock-llm',
    '--json',
  ], configPath));
  transcript.push(await capture(['query', 'activation', '--include-drafts', '--json'], configPath));
  transcript.push(await capture(['review', 'next', '--json'], configPath));
  const queryEntry = transcript.find(entry => entry.args[0] === 'query');
  if (!queryEntry) throw new Error('Acceptance transcript is missing the query step');
  const queryHits = JSON.parse(queryEntry.stdout);
  if (!Array.isArray(queryHits) || queryHits.length === 0) {
    throw new Error(`Expected query hits from ingested claims:\n${queryEntry.stdout}`);
  }
  const sourceTypes = new Set(queryHits.map(hit => hit.sourceType).filter(Boolean));
  if (!sourceTypes.has('linkedin') || !sourceTypes.has('pdf')) {
    throw new Error(`Expected query hits to include both ingested fixture sources:\n${queryEntry.stdout}`);
  }
  const sourceClaimId = queryHits[0].claimId;
  transcript.push(await capture([
    'task',
    'create',
    '--from-claim',
    sourceClaimId,
    '--title',
    'Implement the activation loop',
    '--project',
    'project-viable-prototype',
    '--json',
  ], configPath));
  if (transcript.at(-1).code !== 0 || !transcript.at(-1).stdout.trim()) {
    throw new Error(`Task creation failed before JSON parse:\n${JSON.stringify(transcript.at(-1), null, 2)}`);
  }
  const createdTask = JSON.parse(transcript.at(-1).stdout);
  transcript.push(await capture(['task', 'show', createdTask.taskId, '--json'], configPath));
  transcript.push(await capture(['project', 'reentry', '--project', 'project-viable-prototype', '--json'], configPath));
  transcript.push(await capture([
    'project',
    'reentry',
    '--project',
    'project-viable-prototype',
    '--markdown',
    '--out',
    join(packetRelativeDir, 'project-reentry.txt'),
  ], configPath));
  transcript.push(await capture([
    'export',
    'graph',
    '--jsonld',
    '--out',
    graphExportOut,
  ], configPath));
  if (writeArtifacts) {
    await normalizeJsonLdArtifact(join(packetDir, 'graph-export.jsonld'));
  }

  for (const entry of transcript) {
    if (entry.code !== 0) {
      throw new Error(`Command failed: aidha ${entry.args.join(' ')}\n${entry.stderr}`);
    }
  }

  const verificationStore = SQLiteStore.open(dbPath);
  try {
    const snapshot = await verificationStore.exportSnapshot({ scope: 'full' });
    if (!snapshot.ok) throw snapshot.error;
    const summary = summarizeSnapshot(snapshot.value);
    validateSummary(summary);
    if (writeArtifacts) {
      const jsonLd = await readJsonArtifact(join(packetDir, 'graph-export.jsonld'));
      validateJsonLdExport(jsonLd, summary);
      await writeFile(join(packetDir, 'command-transcript.json'), `${JSON.stringify(transcript, null, 2)}\n`, 'utf-8');
      await writeFile(join(packetDir, 'store-summary.json'), `${JSON.stringify(summary, null, 2)}\n`, 'utf-8');
    }
    return { transcript, summary };
  } finally {
    await verificationStore.close();
  }
}

function summarizeSnapshot(snapshot) {
  const resourceSourceTypes = Array.from(new Set(snapshot.nodes
    .filter(node => node.type === 'Resource')
    .map(node => node.metadata?.sourceType)
    .filter(sourceType => typeof sourceType === 'string')))
    .sort();
  return {
    schemaVersion: snapshot.schemaVersion,
    nodeCount: snapshot.nodes.length,
    edgeCount: snapshot.edges.length,
    resourceSourceTypes,
    stableNodeIds: snapshot.nodes.map(node => node.id).sort(),
    stableEdgeIds: snapshot.edges.map(edge => `${edge.subject}|${edge.predicate}|${edge.object}`).sort(),
    nodeTypes: snapshot.nodes.reduce((acc, node) => {
      acc[node.type] = (acc[node.type] ?? 0) + 1;
      return acc;
    }, {}),
    edgePredicates: snapshot.edges.reduce((acc, edge) => {
      acc[edge.predicate] = (acc[edge.predicate] ?? 0) + 1;
      return acc;
    }, {}),
  };
}

async function readJsonArtifact(path) {
  return JSON.parse(await readFile(path, 'utf-8'));
}

async function normalizeJsonLdArtifact(path) {
  const jsonLd = JSON.parse(redactVolatileOutput(await readFile(path, 'utf-8')));
  for (const node of jsonLd['@graph'] ?? []) {
    if (typeof node.contentHash === 'string') node.contentHash = '<content-hash>';
    if (typeof node.sha256 === 'string') node.sha256 = '<content-hash>';
    if (typeof node.label === 'string' && /^[a-f0-9]{16,64}$/.test(node.label)) {
      node.label = '<stable-excerpt-id>';
    }
    if (Array.isArray(node.dedupKeys)) {
      node.dedupKeys = node.dedupKeys.map(value =>
        typeof value === 'string' && /^[a-f0-9]{16,64}$/.test(value) ? '<content-hash>' : value
      );
    }
  }
  await writeFile(path, `${JSON.stringify(jsonLd, null, 2)}\n`, 'utf-8');
}

function validateJsonLdExport(jsonLd, summary) {
  if (!jsonLd || typeof jsonLd !== 'object') throw new Error('JSON-LD export must be an object');
  if (!Array.isArray(jsonLd['@graph'])) throw new Error('JSON-LD export must contain an @graph array');
  if (jsonLd['@graph'].length !== summary.nodeCount) {
    throw new Error(`JSON-LD node count mismatch: expected ${summary.nodeCount}, got ${jsonLd['@graph'].length}`);
  }
  const nodeIds = new Set(jsonLd['@graph'].map(node => node['@id']));
  for (const stableNodeId of summary.stableNodeIds) {
    if (!nodeIds.has(`urn:aidha:node:${stableNodeId}`)) {
      throw new Error(`JSON-LD export is missing node ${stableNodeId}`);
    }
  }
  const taskNode = jsonLd['@graph'].find(node => node['@type'] === 'Task' && node.taskMotivatedBy);
  if (!taskNode) throw new Error('JSON-LD export must include Task provenance');
}

function validateSummary(summary) {
  for (const requiredSourceType of ['linkedin', 'pdf']) {
    if (!summary.resourceSourceTypes.includes(requiredSourceType)) {
      throw new Error(`Acceptance store is missing ${requiredSourceType} Resource evidence`);
    }
  }
  if ((summary.nodeTypes.Claim ?? 0) < 2) throw new Error('Acceptance store must contain at least two Claims');
  if ((summary.edgePredicates.claimDerivedFrom ?? 0) < 2) throw new Error('Acceptance store must contain Claim provenance edges');
  if ((summary.edgePredicates.taskMotivatedBy ?? 0) < 1) throw new Error('Acceptance store must contain a taskMotivatedBy edge');
}

function comparableSummary(summary) {
  return {
    nodeCount: summary.nodeCount,
    edgeCount: summary.edgeCount,
    resourceSourceTypes: summary.resourceSourceTypes,
    stableNodeIds: summary.stableNodeIds,
    stableEdgeIds: summary.stableEdgeIds,
    nodeTypes: summary.nodeTypes,
    edgePredicates: summary.edgePredicates,
  };
}

async function validateArtifacts() {
  const forbiddenNeedles = [
    tmpdir(),
    homedir(),
    repoRoot,
    '127.0.0.1',
  ].filter(value => value.length > 1);
  const artifacts = [
    'command-transcript.json',
    'store-summary.json',
    'rerun-summary.json',
    'graph-export.jsonld',
    'project-reentry.txt',
    'fixture-prototype.pdf',
  ];
  for (const artifact of artifacts) {
    const artifactPath = join(packetDir, artifact);
    if (!(await pathExists(artifactPath))) throw new Error(`Missing acceptance artifact: ${artifact}`);
    const content = await readFile(artifactPath, 'utf-8');
    if (content.length === 0) throw new Error(`Acceptance artifact is empty: ${artifact}`);
    const leakedValue = forbiddenNeedles.find(value => content.includes(value));
    if (leakedValue) {
      throw new Error(`Acceptance artifact contains local-only path or host (${leakedValue}): ${artifact}`);
    }
  }
}

const firstRun = await runScenario({ writeArtifacts: true });
const secondRun = await runScenario({ writeArtifacts: false });
const deterministic = JSON.stringify(comparableSummary(firstRun.summary)) === JSON.stringify(comparableSummary(secondRun.summary));
if (!deterministic) throw new Error('Acceptance scenario is not deterministic across fresh reruns');
await writeFile(join(packetDir, 'rerun-summary.json'), JSON.stringify({
  deterministic,
  comparedFields: ['nodeCount', 'edgeCount', 'resourceSourceTypes', 'stableNodeIds', 'stableEdgeIds', 'nodeTypes', 'edgePredicates'],
  first: comparableSummary(firstRun.summary),
  second: comparableSummary(secondRun.summary),
}, null, 2) + '\n', 'utf-8');
await validateArtifacts();
const testingDocPath = join(packetDir, 'testing-005-viable-prototype-activation.md');
const testingDocContent = [
  '---',
  'document_id: AIDHA-TESTING-005',
  'owner: Product',
  'status: Draft',
  'version: "0.4"',
  `last_updated: ${runDateIso}`,
  'title: Viable Prototype Activation Acceptance Run',
  'type: TESTING',
  'docops_version: "2.0"',
  'area: CORE',
  'keywords: [prototype, acceptance, activation]',
  'related_ids: [AIDHA-TASK-010, AIDHA-PLAN-008]',
  '---',
  '',
  '<!-- MEMINIT_METADATA_BLOCK -->',
  '> **Document ID:** AIDHA-TESTING-005',
  '> **Owner:** Product',
  '> **Approvers:** -',
  '> **Status:** Draft',
  '> **Version:** 0.4',
  `> **Last Updated:** ${runDateIso}`,
  '> **Type:** TESTING',
  '',
  '# Testing: Viable Prototype Activation Acceptance Run',
  '',
  '## Version History',
  '',
  '| Version | Date       | Author | Change Summary | Reviewers | Status | Reference |',
  '| ------- | ---------- | ------ | -------------- | --------- | ------ | --------- |',
  `| 0.1     | ${runDateIso} | AI     | Record deterministic activation acceptance packet for TASK-010 viable tranche. | - | Draft | AIDHA-TASK-010 |`,
  `| 0.2     | ${runDateIso} | AI     | Update packet evidence to use generic PDF and LinkedIn ingests with deterministic \`--mock-llm\` extraction. | - | Draft | AIDHA-TASK-010 |`,
  `| 0.3     | ${runDateIso} | AI     | Add packet artifact validation and rerun summary evidence. | - | Draft | AIDHA-TASK-010 |`,
  `| 0.4     | ${runDateIso} | AI     | Add generic JSON-LD graph export evidence to the viable prototype packet. | - | Draft | AIDHA-TASK-010 |`,
  '',
  'This packet proves a no-network activation loop against a fresh local SQLite graph populated by two generic CLI ingests.',
  '',
  '- Query retrieves Claims produced by both generic ingests.',
  '- Review surfaces distinct editorial and routing axes.',
  '- Task creation links Task -> Claim.',
  '- Task show and project re-entry trace Claim -> Excerpt -> Resource provenance.',
  '- JSON-LD export preserves the same graph evidence in an interoperable artifact.',
  '',
  '## Acceptance Artifacts',
  '',
  `- Script: \`${join('scripts', 'acceptance', 'viable-prototype-activation.mjs')}\``,
  `- Command transcript: \`${join(packetRelativeDir, 'command-transcript.json')}\``,
  `- PDF fixture: \`${pdfFixtureRelativePath}\``,
  `- Store summary: \`${join(packetRelativeDir, 'store-summary.json')}\``,
  `- Rerun summary: \`${join(packetRelativeDir, 'rerun-summary.json')}\``,
  `- JSON-LD graph export: \`${join(packetRelativeDir, 'graph-export.jsonld')}\``,
  `- Re-entry dossier: \`${join(packetRelativeDir, 'project-reentry.txt')}\``,
  '',
].join('\n');
if (!(await pathExists(testingDocPath))) {
  await writeFile(testingDocPath, testingDocContent, 'utf-8');
}

console.log(packetDir);
