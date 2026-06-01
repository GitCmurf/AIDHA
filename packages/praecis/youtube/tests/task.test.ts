/**
 * Task creation and context tests - WRITTEN FIRST (TDD Red Phase)
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { InMemoryStore } from '@aidha/graph-backend';
import { createActivationTaskFromClaim } from '@aidha/praecis-core';
import {
  createTaskFromClaim,
  createTaskStandalone,
  getTaskContext,
  DEFAULT_INBOX_PROJECT_ID,
} from '../src/tasks/index.js';

describe('Task workflow', () => {
  let store: InMemoryStore;

  beforeEach(async () => {
    store = new InMemoryStore();
  });

  afterEach(async () => {
    await store.close();
  });

  it('creates inbox project and task edges', async () => {
    await store.upsertNode('Claim', 'claim-1', {
      label: 'Capture deterministic IDs',
      metadata: { resourceId: 'youtube-test', videoId: 'test' },
    });

    const result = await createTaskFromClaim(store, {
      claimId: 'claim-1',
      title: 'Document ID strategy',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.projectId).toBe(DEFAULT_INBOX_PROJECT_ID);

    const taskNode = await store.getNode(result.value.taskId);
    expect(taskNode.ok).toBe(true);
    if (!taskNode.ok) return;
    expect(taskNode.value?.type).toBe('Task');

    const projectNode = await store.getNode(DEFAULT_INBOX_PROJECT_ID);
    expect(projectNode.ok).toBe(true);
    if (!projectNode.ok) return;
    expect(projectNode.value?.type).toBe('Project');

    const edges = await store.getEdges({ predicate: 'taskMotivatedBy' });
    expect(edges.ok).toBe(true);
    if (!edges.ok) return;
    expect(edges.value.items.some(edge => edge.object === 'claim-1')).toBe(true);
  });

  it('uses the shared activation helper for claim-backed tasks', async () => {
    const youtubeStore = new InMemoryStore();
    const genericStore = new InMemoryStore();
    try {
      for (const targetStore of [youtubeStore, genericStore]) {
        await targetStore.upsertNode('Claim', 'claim-shared', {
          label: 'Route task activation through shared helpers',
          metadata: { resourceId: 'youtube-test', videoId: 'test' },
        });
      }

      const input = {
        claimId: 'claim-shared',
        title: 'Unify task activation',
        projectId: 'inbox',
        tags: ['activation'],
      };
      const youtubeResult = await createTaskFromClaim(youtubeStore, input);
      const genericResult = await createActivationTaskFromClaim(genericStore, input);
      expect(youtubeResult.ok).toBe(true);
      expect(genericResult.ok).toBe(true);
      if (!youtubeResult.ok || !genericResult.ok) return;

      expect(youtubeResult.value).toEqual(genericResult.value);
      const youtubeTask = await youtubeStore.getNode(youtubeResult.value.taskId);
      const genericTask = await genericStore.getNode(genericResult.value.taskId);
      expect(youtubeTask.ok).toBe(true);
      expect(genericTask.ok).toBe(true);
      if (!youtubeTask.ok || !genericTask.ok) return;
      expect(youtubeTask.value?.metadata).toEqual(genericTask.value?.metadata);
    } finally {
      await youtubeStore.close();
      await genericStore.close();
    }
  });

  it('returns task context with claim excerpt details', async () => {
    await store.upsertNode('Resource', 'youtube-test', {
      label: 'Test Video',
      metadata: { url: 'https://www.youtube.com/watch?v=test', videoId: 'test' },
    });
    await store.upsertNode('Excerpt', 'excerpt-1', {
      label: 'Excerpt 1',
      content: 'Use hashing to keep IDs stable.',
      metadata: { resourceId: 'youtube-test', videoId: 'test', start: 90, duration: 5 },
    });
    await store.upsertNode('Claim', 'claim-1', {
      label: 'Hash IDs for stability',
      content: 'Hash IDs for stability.',
      metadata: { resourceId: 'youtube-test', videoId: 'test' },
    });
    await store.upsertEdge('claim-1', 'claimDerivedFrom', 'excerpt-1', {});

    const created = await createTaskFromClaim(store, {
      claimId: 'claim-1',
      title: 'Document hashing',
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const context = await getTaskContext(store, created.value.taskId);
    expect(context.ok).toBe(true);
    if (!context.ok) return;
    expect(context.value.claims.length).toBeGreaterThan(0);
    const claim = context.value.claims[0];
    expect(claim.excerptText).toContain('Use hashing');
    expect(claim.timestampUrl).toContain('t=90s');
  });

  it('creates standalone task without claim linkage', async () => {
    const created = await createTaskStandalone(store, {
      title: 'Explore ingestion diagnostics',
      projectId: 'inbox',
      tags: ['ops'],
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const taskNode = await store.getNode(created.value.taskId);
    expect(taskNode.ok).toBe(true);
    if (!taskNode.ok) return;
    expect(taskNode.value?.type).toBe('Task');

    const motivationEdges = await store.getEdges({
      subject: created.value.taskId,
      predicate: 'taskMotivatedBy',
    });
    expect(motivationEdges.ok).toBe(true);
    if (!motivationEdges.ok) return;
    expect(motivationEdges.value.items.length).toBe(0);
  });
});
