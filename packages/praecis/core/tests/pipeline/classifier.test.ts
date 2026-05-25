// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 Colin Farmer (GitCmurf)

import { describe, expect, it } from 'vitest';
import { InMemoryStore } from '@aidha/graph-backend';
import { InMemoryRegistry } from '@aidha/taxonomy';
import { createTaxonomyRegistryFromConfig, KeywordTaxonomyClassifier } from '../../src/pipeline/services.js';
import type { ResolvedConfig } from '../../src/index.js';

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
  it('builds a seeded registry from resolved config extensions', async () => {
    const config = {
      extensions: {
        global: {
          taxonomy: {
            categories: [{ id: 'cat-1', name: 'Global' }],
            topics: [{ id: 'topic-1', name: 'Global Topic', categoryId: 'cat-1' }],
            tags: [{ id: 'tag-1', name: 'global', topicIds: ['topic-1'] }],
          },
        },
        profile: {
          taxonomy: {
            tags: [{ id: 'tag-1', name: 'profile', aliases: ['profile-alias'], topicIds: ['topic-1'] }],
          },
        },
      },
    } as ResolvedConfig;

    const registryResult = await createTaxonomyRegistryFromConfig(config);

    expect(registryResult.ok).toBe(true);
    if (!registryResult.ok || !registryResult.value) throw new Error('expected registry');
    const tag = await registryResult.value.getTag('tag-1');
    expect(tag.ok).toBe(true);
    if (!tag.ok) throw tag.error;
    expect(tag.value?.name).toBe('profile');
    expect(tag.value?.aliases).toEqual(['profile-alias']);
    await registryResult.value.close();
  });

  it('returns no registry when config has no taxonomy extension', async () => {
    const result = await createTaxonomyRegistryFromConfig({} as ResolvedConfig);

    expect(result).toEqual({ ok: true, value: undefined });
  });

  it('persists graph-backed assignments on resource metadata', async () => {
    const store = new InMemoryStore();
    const resource = await store.upsertNode('Resource', 'web:https://example.com', {
      label: 'Example',
      metadata: { canonicalId: 'web:https://example.com', sourceType: 'web', provenances: [] },
    });
    expect(resource.ok).toBe(true);
    if (!resource.ok) throw resource.error;

    const registryResult = await createTaxonomyRegistryFromConfig({
      extensions: {
        global: {
          taxonomy: {
            categories: [{ id: 'cat-1', name: 'Articles' }],
            topics: [{ id: 'topic-1', name: 'Web', categoryId: 'cat-1' }],
            tags: [{ id: 'tag-1', name: 'resilience', topicIds: ['topic-1'] }],
          },
        },
      },
    } as ResolvedConfig, { store });
    expect(registryResult.ok).toBe(true);
    if (!registryResult.ok || !registryResult.value) throw new Error('expected graph-backed registry');

    const assigned = await registryResult.value.assignTag({
      nodeId: 'web:https://example.com',
      tagId: 'tag-1',
      confidence: 0.7,
      source: 'automatic',
      assignedBy: 'test',
    });
    expect(assigned.ok).toBe(true);
    if (!assigned.ok) throw assigned.error;

    const persisted = await store.getNode('web:https://example.com');
    expect(persisted.ok).toBe(true);
    if (!persisted.ok) throw persisted.error;
    expect(persisted.value?.metadata?.['taxonomyAssignments']).toMatchObject([{
      nodeId: 'web:https://example.com',
      tagId: 'tag-1',
      confidence: 0.7,
      source: 'automatic',
      assignedBy: 'test',
    }]);

    const assignments = await registryResult.value.getAssignments('web:https://example.com');
    expect(assignments.ok).toBe(true);
    if (!assignments.ok) throw assignments.error;
    expect(assignments.value).toHaveLength(1);

    const removed = await registryResult.value.removeAssignment('web:https://example.com', 'tag-1');
    expect(removed.ok).toBe(true);
    if (!removed.ok) throw removed.error;
    const afterRemove = await registryResult.value.getAssignments('web:https://example.com');
    expect(afterRemove.ok).toBe(true);
    if (!afterRemove.ok) throw afterRemove.error;
    expect(afterRemove.value).toEqual([]);

    await registryResult.value.close();
    await store.close();
  });

  it('reports malformed taxonomy seed entries at the config boundary', async () => {
    const result = await createTaxonomyRegistryFromConfig({
      extensions: {
        global: {
          taxonomy: {
            tags: [{ id: 'tag-1', name: 'missing topics' }],
          },
        },
      },
    } as ResolvedConfig);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toContain('Invalid taxonomy tags entry at global.tags[0] id="tag-1"');
    expect(result.error.message).toContain('topicIds');
  });

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
    expect(result.value).toEqual({ status: 'completed', tagsMatched: 1, tagsAssigned: 1, warnings: [] });

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
    const rerun = await classifier.classify(request);

    expect(rerun.ok).toBe(true);
    if (!rerun.ok) throw rerun.error;
    expect(rerun.value).toEqual({ status: 'completed', tagsMatched: 1, tagsAssigned: 0, warnings: [] });
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
    expect(result.value).toEqual({ status: 'completed', tagsMatched: 0, tagsAssigned: 0, warnings: [] });

    await registry.close();
  });
});
