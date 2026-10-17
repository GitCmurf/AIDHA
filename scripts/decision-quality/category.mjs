// SPDX-License-Identifier: Apache-2.0
import { InMemoryStore } from '../../packages/reconditum/dist/index.js';
import { composeVector, createConfiguredPipelineServices, createDefaultPipelineServices,
  createIngestionRuntimeFromServices } from '../../packages/praecis/core/dist/index.js';

const fixedClock = { now: () => new Date('2026-10-17T00:00:00.000Z') };

/** A model-visible category question; labels and reviewer notes stay in the corpus. */
export function buildCategoryRequest(testCase, taxonomy) {
  const state = {
    source: { label: testCase.source.label, body: testCase.source.body },
    taxonomy: {
      categories: taxonomy.categories.map(({ id, name }) => ({ id, name })),
      topics: taxonomy.topics.map(({ id, name, categoryId }) => ({ id, name, categoryId })),
      tags: taxonomy.tags.map(({ id, name, aliases, topicIds }) => ({ id, name, aliases, topicIds })),
    },
  };
  const questions = Object.fromEntries(taxonomy.tags.map(tag => [tag.id, {
    type: 'choice', choices: ['applies', 'not_applicable', 'unknown'],
    instructions: `Does the source substantively concern ${tag.name}? Negated mentions, menu labels and passing procedural references do not make a category apply. Choose unknown if the source does not give enough context.`,
  }]));
  return { state, questions };
}

/** Reuse the configured taxonomy classifier and shared ingestion runtime, reading durable graph state. */
export async function runKeywordBaseline(corpus) {
  const results = [];
  for (const testCase of corpus.cases) {
    const store = new InMemoryStore();
    let registry;
    try {
      const base = createDefaultPipelineServices({ store });
      const config = { ...base.config, extensions: { global: { taxonomy: corpus.taxonomy } } };
      const miner = { async mine() { return { ok: true, value: { claims: [], rejectedClaims: [], tokenUsage: 0 } }; } };
      const configured = await createConfiguredPipelineServices({ store, config, clock: fixedClock, miner });
      if (!configured.ok) throw configured.error;
      registry = configured.value.taxonomyRegistry;
      if (!configured.value.classifier || !registry) throw new Error('Configured keyword classifier is missing');
      const { source } = testCase;
      const segment = { id: 'source-body', text: source.body,
        locator: { kind: 'text', charStart: 0, charEnd: source.body.length } };
      const vector = composeVector({ sourceId: 'decision-category', sensitivity: 'public',
        registration: { sourceId: 'decision-category', validateActiveSourceConfig: value => value },
        ingestor: { sourceId: 'decision-category', acquire: async () => ({ ok: true, value: {
          canonicalId: source.canonicalId, sourceType: source.sourceType, label: source.label,
          sensitivity: 'public', provenance: { ingestedAt: fixedClock.now().toISOString(), sourceType: 'web' }, payload: {},
        } }) },
        decode: [{ name: 'synthetic-body', decode: async () => ({ ok: true, value: { segments: [segment], warnings: [] } }) }],
        context: { build: async () => ({}) },
        chunking: { name: 'synthetic-body', chunk: async () => ({ ok: true,
          value: [{ id: segment.id, text: segment.text, segments: [segment], locator: segment.locator }] }) },
      });
      const report = await createIngestionRuntimeFromServices(configured.value).runVector(vector, { ref: source.canonicalId });
      if (!report.ok) throw report.error;
      const persisted = await store.getNode(report.value.resourceId);
      if (!persisted.ok) throw persisted.error;
      if (!persisted.value) throw new Error(`Missing persisted Resource for ${testCase.id}`);
      const resource = { id: persisted.value.id, metadata: persisted.value.metadata };
      const assignments = resource.metadata?.taxonomyAssignments ?? [];
      results.push({ caseId: testCase.id, assignedTags: assignments.map(value => value.tagId).sort(),
        resource, request: buildCategoryRequest(testCase, corpus.taxonomy) });
    } finally {
      await registry?.close();
      await store.close();
    }
  }
  return results;
}
