#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 Colin Farmer (GitCmurf)

import { access, mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
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
const workDir = await mkdtemp(join(tmpdir(), 'aidha-viable-prototype-'));
const dbPath = join(workDir, 'activation.sqlite');
const configPath = join(workDir, 'aidha.config.yaml');

await mkdir(packetDir, { recursive: true });
await writeFile(configPath, [
  'config_version: 1',
  'default_profile: local',
  'profiles:',
  '  local:',
  `    db: ${JSON.stringify(dbPath)}`,
  '',
].join('\n'), 'utf-8');

async function pathExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function redactVolatileOutput(value) {
  return value
    .replaceAll(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/g, '<timestamp>')
    .replaceAll(/\(node:\d+\)/g, '(node:<pid>)');
}

const store = SQLiteStore.open(dbPath);
try {
  await store.upsertNode('Resource', 'res-web-activation', {
    label: 'Activation article',
    metadata: { sourceType: 'web', url: 'https://example.test/activation' },
  });
  await store.upsertNode('Excerpt', 'exc-web-activation', {
    label: 'Activation excerpt',
    content: 'AIDHA should turn prior knowledge into concrete next actions.',
    metadata: {
      resourceId: 'res-web-activation',
      locator: { kind: 'dom', textFragment: 'prior knowledge', charStart: 18, charEnd: 33 },
    },
  });
  await store.upsertNode('Claim', 'claim-web-activation', {
    label: 'AIDHA should turn prior knowledge into concrete next actions.',
    content: 'AIDHA should turn prior knowledge into concrete next actions.',
    metadata: {
      resourceId: 'res-web-activation',
      state: 'accepted',
      routingReviewStatus: 'unreviewed',
      confidence: 0.66,
    },
  });
  await store.upsertEdge('claim-web-activation', 'claimDerivedFrom', 'exc-web-activation', {});

  await store.upsertNode('Resource', 'res-pdf-provenance', {
    label: 'Prototype planning PDF',
    metadata: { sourceType: 'pdf' },
  });
  await store.upsertNode('Excerpt', 'exc-pdf-provenance', {
    label: 'PDF excerpt',
    content: 'Project re-entry needs task provenance back to claims and sources.',
    metadata: {
      resourceId: 'res-pdf-provenance',
      locator: { kind: 'page', page: 3, charStart: 0, charEnd: 64 },
    },
  });
  await store.upsertNode('Claim', 'claim-pdf-provenance', {
    label: 'Project re-entry needs task provenance back to claims and sources.',
    content: 'Project re-entry needs task provenance back to claims and sources.',
    metadata: {
      resourceId: 'res-pdf-provenance',
      state: 'draft',
      routingReviewStatus: 'confirmed',
    },
  });
  await store.upsertEdge('claim-pdf-provenance', 'claimDerivedFrom', 'exc-pdf-provenance', {});
} finally {
  await store.close();
}

async function capture(args) {
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

const transcript = [];
transcript.push(await capture(['query', 'activation', '--json']));
transcript.push(await capture(['review', 'next', '--json']));
transcript.push(await capture([
  'task',
  'create',
  '--from-claim',
  'claim-web-activation',
  '--title',
  'Implement the activation loop',
  '--project',
  'project-viable-prototype',
  '--json',
]));
if (transcript.at(-1).code !== 0 || !transcript.at(-1).stdout.trim()) {
  throw new Error(`Task creation failed before JSON parse:\n${JSON.stringify(transcript.at(-1), null, 2)}`);
}
const createdTask = JSON.parse(transcript.at(-1).stdout);
transcript.push(await capture(['task', 'show', createdTask.taskId, '--json']));
transcript.push(await capture(['project', 'reentry', '--project', 'project-viable-prototype', '--json']));
transcript.push(await capture([
  'project',
  'reentry',
  '--project',
  'project-viable-prototype',
  '--markdown',
  '--out',
  join(packetRelativeDir, 'project-reentry.txt'),
]));

for (const entry of transcript) {
  if (entry.code !== 0) {
    throw new Error(`Command failed: aidha ${entry.args.join(' ')}\n${entry.stderr}`);
  }
}

await writeFile(join(packetDir, 'command-transcript.json'), JSON.stringify(transcript, null, 2), 'utf-8');
const verificationStore = SQLiteStore.open(dbPath);
try {
  const snapshot = await verificationStore.exportSnapshot({ scope: 'full' });
  if (!snapshot.ok) throw snapshot.error;
  await writeFile(join(packetDir, 'store-summary.json'), JSON.stringify({
    schemaVersion: snapshot.value.schemaVersion,
    nodeCount: snapshot.value.nodes.length,
    edgeCount: snapshot.value.edges.length,
    nodeTypes: snapshot.value.nodes.reduce((acc, node) => {
      acc[node.type] = (acc[node.type] ?? 0) + 1;
      return acc;
    }, {}),
    edgePredicates: snapshot.value.edges.reduce((acc, edge) => {
      acc[edge.predicate] = (acc[edge.predicate] ?? 0) + 1;
      return acc;
    }, {}),
  }, null, 2), 'utf-8');
} finally {
  await verificationStore.close();
}
const testingDocPath = join(packetDir, 'testing-005-viable-prototype-activation.md');
const testingDocContent = [
  '---',
  'document_id: AIDHA-TESTING-005',
  'owner: Product',
  'status: Draft',
  'version: "0.1"',
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
  '> **Version:** 0.1',
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
  '',
  'This packet proves a no-network activation loop against a fresh local SQLite graph seeded with two source types.',
  '',
  '- Query retrieves a prior accepted Claim.',
  '- Review surfaces distinct editorial and routing axes.',
  '- Task creation links Task -> Claim.',
  '- Task show and project re-entry trace Claim -> Excerpt -> Resource provenance.',
  '',
  '## Acceptance Artifacts',
  '',
  `- Script: \`${join('scripts', 'acceptance', 'viable-prototype-activation.mjs')}\``,
  `- Command transcript: \`${join(packetRelativeDir, 'command-transcript.json')}\``,
  `- Store summary: \`${join(packetRelativeDir, 'store-summary.json')}\``,
  `- Re-entry dossier: \`${join(packetRelativeDir, 'project-reentry.txt')}\``,
  '',
].join('\n');
if (!(await pathExists(testingDocPath))) {
  await writeFile(testingDocPath, testingDocContent, 'utf-8');
}

console.log(packetDir);
