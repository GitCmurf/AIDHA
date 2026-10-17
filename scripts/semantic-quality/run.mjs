// SPDX-License-Identifier: Apache-2.0
import { InMemoryStore } from '../../packages/reconditum/dist/index.js';
import { SourceDistillationMiner, composeVector, createDefaultPipelineServices,
  createIngestionRuntimeFromServices } from '../../packages/praecis/core/dist/index.js';

/** Run source-only inputs through the production miner, runtime and graph exporter. */
export async function runSemanticCase({ testCase, llm, model }) {
  const store = new InMemoryStore();
  const canonicalId = testCase.canonicalId ?? `synthetic:${testCase.id}`;
  let offset = 0;
  const segments = testCase.excerpts.map(excerpt => {
    const locator = { kind: 'text', charStart: offset, charEnd: offset + excerpt.text.length };
    offset = locator.charEnd + 2;
    return { ...excerpt, locator };
  });
  const vector = composeVector({ sourceId: 'semantic-quality', sensitivity: 'public',
    registration: { sourceId: 'semantic-quality', validateActiveSourceConfig: value => value },
    ingestor: { sourceId: 'semantic-quality', acquire: async () => ({ ok: true, value: {
      canonicalId, sourceType: 'web', label: testCase.label ?? testCase.title, sensitivity: 'public',
      provenance: { ingestedAt: '2026-10-17T00:00:00Z', sourceType: 'web' }, payload: {} } }) },
    decode: [{ name: 'semantic-source', decode: async () => ({ ok: true, value: { segments, warnings: [] } }) }],
    context: { build: async () => ({}) },
    chunking: { name: 'semantic-excerpts', chunk: async () => ({ ok: true,
      value: segments.map(segment => ({ id: segment.id, text: segment.text, segments: [segment], locator: segment.locator })) }) },
  });
  try {
    const services = createDefaultPipelineServices({ store, llm, miner: new SourceDistillationMiner() });
    services.config.llm = { ...services.config.llm, model };
    const result = await createIngestionRuntimeFromServices(services).runVector(vector, { ref: canonicalId });
    if (!result.ok) throw result.error;
    const nodes = await store.queryNodes({ type: 'Claim' });
    if (!nodes.ok) throw nodes.error;
    return { caseId: testCase.id, report: result.value, persistedClaims: nodes.value.items,
      expectations: testCase.expected ?? testCase.expectations };
  } finally { await store.close(); }
}
