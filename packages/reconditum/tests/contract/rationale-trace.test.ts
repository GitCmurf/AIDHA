// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 Colin Farmer (GitCmurf)

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { toJsonLd } from '../../src/export/index.js';
import { NodeType } from '../../src/schema/index.js';
import { InMemoryStore } from '../../src/store/index.js';

describe('RationaleTrace graph contract', () => {
  let store: InMemoryStore;

  beforeEach(() => {
    store = new InMemoryStore();
  });

  afterEach(async () => {
    await store.close();
  });

  it('includes RationaleTrace in the graph node type enum', () => {
    expect(NodeType.options).toContain('RationaleTrace');
  });

  it('stores, relates, queries, and exports RationaleTrace nodes', async () => {
    await store.upsertNode('Claim', 'claim-a', {
      label: 'Claim A',
      content: 'A claim that needs relationship rationale.',
    });
    await store.upsertNode('Reference', 'ref-a', {
      label: 'Reference A',
      metadata: { url: 'https://example.com/source' },
    });

    const traceResult = await store.upsertNode('RationaleTrace', 'trace-a', {
      label: 'Claim A corroboration rationale',
      content: 'The reference appears to corroborate the claim, pending review.',
      metadata: {
        traceKind: 'suggested_link',
        affectedNodeIds: ['claim-a', 'ref-a'],
        proposedPredicate: 'corroboratedBy',
        rationale: 'The reference repeats the claim with independent wording.',
        confidence: 0.72,
        agentModel: 'mock-acceptance-llm',
        promptVersion: 'trace-v1',
        inputContext: { claimId: 'claim-a', referenceId: 'ref-a' },
        traceReviewStatus: 'open',
      },
    });
    expect(traceResult.ok).toBe(true);
    if (!traceResult.ok) return;
    expect(traceResult.value.node.type).toBe('RationaleTrace');
    expect(traceResult.value.node.metadata['proposedPredicate']).toBe('corroboratedBy');

    const claimEdge = await store.upsertEdge('trace-a', 'derivedFrom', 'claim-a', {});
    const referenceEdge = await store.upsertEdge('trace-a', 'alsoSeenVia', 'ref-a', {});
    expect(claimEdge.ok).toBe(true);
    expect(referenceEdge.ok).toBe(true);

    const traces = await store.queryNodes({ type: 'RationaleTrace' });
    expect(traces.ok).toBe(true);
    if (!traces.ok) return;
    expect(traces.value.items).toHaveLength(1);
    expect(traces.value.items[0]?.id).toBe('trace-a');

    const traceEdges = await store.getEdges({ subject: 'trace-a' });
    expect(traceEdges.ok).toBe(true);
    if (!traceEdges.ok) return;
    expect(traceEdges.value.items.map(edge => edge.predicate).sort()).toEqual([
      'alsoSeenVia',
      'derivedFrom',
    ]);

    const doc = toJsonLd(traces.value.items, traceEdges.value.items);
    const jsonTrace = doc['@graph'].find(node => node['@id'] === 'urn:aidha:node:trace-a');
    expect(jsonTrace?.['@type']).toBe('RationaleTrace');
    expect(jsonTrace?.['proposedPredicate']).toBe('corroboratedBy');
    expect(jsonTrace?.['derivedFrom']).toBe('urn:aidha:node:claim-a');
    expect(jsonTrace?.['alsoSeenVia']).toBe('urn:aidha:node:ref-a');
  });
});
