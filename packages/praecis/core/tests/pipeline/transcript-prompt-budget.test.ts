import { afterEach, expect, it } from 'vitest';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveConfig } from '@aidha/config';
import { CURRENT_GRAPH_SCHEMA_VERSION, InMemoryStore, type GraphNode } from '@aidha/graph-backend';
import { composeVector, createIngestionRuntime } from '../../src/index.js';
import { LlmClaimExtractor } from '../../src/extract/llm-claims.js';
import { MemoryCache } from '../../src/pipeline/services.js';
import { estimateTokens } from '../../src/extract/token-budget.js';
import type { LlmCompletionRequest } from '../../src/extract/llm-client.js';
import { RecordingLlm } from './transcript-prompt-fixture.js';

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { force: true, recursive: true }); });
const directory = () => { const dir = mkdtempSync(join(tmpdir(), 'aidha-hard-budget-')); dirs.push(dir); return dir; };
const node = (id: string, type: GraphNode['type'], content: string, start = 0): GraphNode => ({
  id, type, content, label: id, schemaVersion: CURRENT_GRAPH_SCHEMA_VERSION,
  metadata: { start }, createdAt: '2026-10-18T00:00:00Z', updatedAt: '2026-10-18T00:00:00Z',
});
const giant = 'A fully retained fictional excerpt cannot fit the configured hard input budget. '.repeat(1000);

it('preflights every chunk before calling a provider or writing any claim cache entry', async () => {
  const dir = directory();
  const llm = new RecordingLlm([]);
  const extractor = new LlmClaimExtractor({ client: llm, model: 'test-model', promptVersion: 'v1', cacheDir: dir });
  await expect(extractor.extractClaims({ resource: node('r', 'Resource', ''), excerpts: [
    node('small', 'Excerpt', 'A short acceptable first excerpt describes linked files.', 0),
    node('large', 'Excerpt', giant, 1200),
  ] })).rejects.toMatchObject({ name: 'ClaimRequestBudgetError', hardLimit: 6000, chunkIndex: 1 });
  expect(llm.requests).toHaveLength(0);
  expect(readdirSync(dir)).toEqual([]);
});

it('returns a typed configured-runtime failure and preserves prior graph output on hard-budget rejection', async () => {
  const dir = directory();
  const store = new InMemoryStore();
  await store.upsertNode('Resource', 'prior', { label: 'Previously accepted source', metadata: {} });
  await store.upsertNode('Claim', 'prior-claim', { label: 'Previously accepted claim', content: 'Keep the prior output.', metadata: {} });
  const before = await store.exportSnapshot({ scope: 'full' });
  if (!before.ok) throw before.error;
  const llm = new RecordingLlm([]);
  const config = resolveConfig({ env: {}, baseDir: dir, cliOverrides: {
    llm: { model: 'test-model', cache_dir: dir }, extraction: { prompt_version: 'v1' },
  } });
  const created = await createIngestionRuntime({ store, config, llm, cache: new MemoryCache(),
    clock: { now: () => new Date('2026-10-18T00:00:00Z') } });
  if (!created.ok) throw created.error;
  const vector = composeVector({
    sourceId: 'fixture', sensitivity: 'public', registration: { sourceId: 'fixture', validateActiveSourceConfig: value => value },
    ingestor: { sourceId: 'fixture', acquire: async () => ({ ok: true, value: {
      canonicalId: 'fixture:large', label: 'Fictional oversized source', sourceType: 'web', sensitivity: 'public', payload: {},
      provenance: { sourceType: 'web', ingestedAt: '2026-10-18T00:00:00Z' },
    } }) },
    decode: [{ name: 'fixture', decode: async () => ({ ok: true, value: {
      segments: [{ id: 's', text: giant, locator: { kind: 'text', charStart: 0, charEnd: giant.length } }], warnings: [],
    } }) }],
    context: { build: async () => ({}) },
    chunking: { name: 'fixture', chunk: async ({ segments }) => ({ ok: true, value: [
      { id: 'e', text: giant, segments, locator: { kind: 'text', charStart: 0, charEnd: giant.length } },
    ] }) },
  });
  try {
    const result = await created.value.runVector(vector, { ref: 'fixture:large' });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('Expected hard budget rejection');
    expect(result.error).toMatchObject({ name: 'ClaimRequestBudgetError', hardLimit: 6000 });
    expect(llm.requests).toHaveLength(0);
    expect(readdirSync(dir)).toEqual([]);
    expect(await store.exportSnapshot({ scope: 'full' })).toEqual(before);
  } finally { await created.value.close(); await store.close(); }
});

const reply = (excerptId: string) => JSON.stringify({ claims: [{
  text: 'Linked-file navigation applies to small collections because larger corpora exceed practical crawl limits.',
  excerptIds: [excerptId], confidence: 0.9, type: 'mechanism',
}] });
it('rejects overflowing parse-feedback retry before its provider call without caching or heuristic fallback', async () => {
  const probe = new RecordingLlm([reply('ex1')]);
  const input = { resource: node('r', 'Resource', ''), excerpts: [node('ex1', 'Excerpt', 'A fictional source describes linked index navigation.')] };
  await new LlmClaimExtractor({ client: probe, model: 'test-model', promptVersion: 'v1', cacheDir: directory() }).extractClaims(input);
  const initial = probe.requests[0];
  if (!initial) throw new Error('Missing baseline request');
  const hardLimit = estimateTokens(initial.system) + estimateTokens(initial.user);
  const llm = new RecordingLlm(['not-json', reply('ex1')]);
  const dir = directory();
  const extractor = new LlmClaimExtractor({ client: llm, model: 'test-model', promptVersion: 'v1', cacheDir: dir,
    chunkHardMaxInputTokens: hardLimit });
  await expect(extractor.extractClaims(input)).rejects.toMatchObject({ name: 'ClaimRequestBudgetError', hardLimit });
  expect(llm.requests).toHaveLength(1);
  expect(readdirSync(dir)).toEqual([]);
});

it('keeps target-only oversize intact when it fits the hard limit', async () => {
  const llm = new RecordingLlm([reply('ex1')]);
  const text = 'Linked-file navigation preserves source evidence. '.repeat(60);
  await new LlmClaimExtractor({ client: llm, model: 'test-model', promptVersion: 'v1', cacheDir: directory(),
    chunkTargetInputTokens: 100, chunkHardMaxInputTokens: 6000 }).extractClaims({
    resource: node('r', 'Resource', ''), excerpts: [node('ex1', 'Excerpt', text)],
  });
  expect(llm.requests).toHaveLength(1);
  expect(llm.requests[0]?.user).toContain(text.trim());
});

it('retains existing multi-excerpt splitting while keeping every intact payload within its hard limit', async () => {
  const requests: LlmCompletionRequest[] = [];
  const observed: unknown[] = [];
  const client = { async generate(request: LlmCompletionRequest) {
    requests.push(request);
    const marker = 'EXCERPTS:\n';
    const encoded = request.user.slice(request.user.indexOf(marker) + marker.length);
    const payload = JSON.parse(encoded.slice(3, -3)) as { id: string; text: string }[];
    observed.push(...payload);
    const first = payload[0];
    if (!first) throw new Error('Missing source excerpt');
    return { ok: true as const, value: reply(first.id) };
  } };
  const excerpts = [0, 1, 2, 3].map(index => node(`e${index}`, 'Excerpt', `Source ${index} explains linked navigation. `.repeat(30)));
  await new LlmClaimExtractor({ client, model: 'test-model', promptVersion: 'v1', cacheDir: directory(),
    chunkTargetInputTokens: 700, chunkHardMaxInputTokens: 1000 }).extractClaims({ resource: node('r', 'Resource', ''), excerpts });
  expect(requests.length).toBeGreaterThan(1);
  for (const request of requests) expect(estimateTokens(request.system) + estimateTokens(request.user)).toBeLessThanOrEqual(1000);
  expect(observed).toEqual(excerpts.map(excerpt => ({ id: excerpt.id, startSeconds: 0, text: excerpt.content?.trim() })));
});
