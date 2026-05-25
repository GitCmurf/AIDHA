// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 Colin Farmer (GitCmurf)

import { describe, expect, it } from 'vitest';
import { InMemoryRegistry } from '@aidha/taxonomy';
import { KeywordTaxonomyClassifier } from '../../src/pipeline/services.js';

async function registryWithTag() {
  const registry = new InMemoryRegistry();
  await registry.addCategory({ id: 'cat-1', name: 'Technology' });
  await registry.addTopic({ id: 'topic-1', name: 'Programming', categoryId: 'cat-1' });
  await registry.addTag({
    id: 'tag-1',
    name: 'tutorial',
    aliases: ['walkthrough'],
    topicIds: ['topic-1'],
  });
  return registry;
}

describe('KeywordTaxonomyClassifier', () => {
  it('assigns taxonomy tags by tag name or alias', async () => {
    const registry = await registryWithTag();
    const classifier = new KeywordTaxonomyClassifier(registry);

    const result = await classifier.classify({
      raw: {
        canonicalId: 'youtube-test-video',
        sourceType: 'youtube',
        sensitivity: 'public',
        provenance: { ingestedAt: '2026-05-25T00:00:00.000Z', sourceType: 'youtube' },
        payload: {},
        label: 'Fixture',
      },
      resourceId: 'youtube-test-video',
      excerptIds: [],
      claimIds: [],
      claims: [],
      chunks: [{
        id: 'chunk-1',
        segments: [],
        text: 'This walkthrough explains the ingestion path.',
        locator: { kind: 'text', charStart: 0, charEnd: 46 },
      }],
      context: {},
      config: {} as Parameters<KeywordTaxonomyClassifier['classify']>[0]['config'],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw result.error;
    expect(result.value).toEqual({ status: 'completed', tagsAssigned: 1, warnings: [] });

    const assignments = await registry.getAssignments('youtube-test-video');
    expect(assignments.ok).toBe(true);
    if (!assignments.ok) throw assignments.error;
    expect(assignments.value).toMatchObject([{
      nodeId: 'youtube-test-video',
      tagId: 'tag-1',
      confidence: 0.7,
      source: 'automatic',
      assignedBy: 'praecis-keyword-classifier',
    }]);

    await registry.close();
  });

  it('does not duplicate assignments on rerun', async () => {
    const registry = await registryWithTag();
    const classifier = new KeywordTaxonomyClassifier(registry);
    const request: Parameters<KeywordTaxonomyClassifier['classify']>[0] = {
      raw: {
        canonicalId: 'youtube-test-video',
        sourceType: 'youtube',
        sensitivity: 'public',
        provenance: { ingestedAt: '2026-05-25T00:00:00.000Z', sourceType: 'youtube' },
        payload: {},
        label: 'tutorial',
      },
      resourceId: 'youtube-test-video',
      excerptIds: [],
      claimIds: [],
      claims: [],
      chunks: [],
      context: {},
      config: {} as Parameters<KeywordTaxonomyClassifier['classify']>[0]['config'],
    };

    await classifier.classify(request);
    await classifier.classify(request);

    const assignments = await registry.getAssignments('youtube-test-video');
    expect(assignments.ok).toBe(true);
    if (!assignments.ok) throw assignments.error;
    expect(assignments.value).toHaveLength(1);

    await registry.close();
  });

  it('reports completed with zero assignments for an empty registry', async () => {
    const registry = new InMemoryRegistry();
    const classifier = new KeywordTaxonomyClassifier(registry);

    const result = await classifier.classify({
      raw: {
        canonicalId: 'web:https://example.com',
        sourceType: 'web',
        sensitivity: 'public',
        provenance: { ingestedAt: '2026-05-25T00:00:00.000Z', sourceType: 'web' },
        payload: {},
        label: 'tutorial',
      },
      resourceId: 'web:https://example.com',
      excerptIds: [],
      claimIds: [],
      claims: [],
      chunks: [],
      context: {},
      config: {} as Parameters<KeywordTaxonomyClassifier['classify']>[0]['config'],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw result.error;
    expect(result.value).toEqual({ status: 'completed', tagsAssigned: 0, warnings: [] });

    await registry.close();
  });
});
