import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SQLiteStore } from '@aidha/graph-backend';
import { applyReviewAction } from '../src/review/index.js';

describe('review workflow (SQLite atomicity)', () => {
  let store: SQLiteStore;

  beforeEach(async () => {
    store = SQLiteStore.createInMemory();
    await store.upsertNode('Resource', 'youtube-sqlite-video', {
      label: 'SQLite Review Video',
      metadata: {
        videoId: 'sqlite-video',
        url: 'https://www.youtube.com/watch?v=sqlite-video',
      },
    });
    await store.upsertNode('Claim', 'sqlite-claim-a', {
      label: 'Claim A',
      content: 'First claim.',
      metadata: {
        resourceId: 'youtube-sqlite-video',
        videoId: 'sqlite-video',
        state: 'draft',
      },
    });
    await store.upsertNode('Claim', 'sqlite-claim-b', {
      label: 'Claim B',
      content: 'Second claim.',
      metadata: {
        resourceId: 'youtube-sqlite-video',
        videoId: 'sqlite-video',
        state: 'draft',
      },
    });
  });

  afterEach(async () => {
    await store.close();
  });

  it('does not partially apply batch updates when one claim ID is invalid', async () => {
    const action = await applyReviewAction(store, {
      claimIds: ['sqlite-claim-a', 'missing-claim', 'sqlite-claim-b'],
      state: 'accepted',
      tags: ['atomicity'],
      createTask: {
        title: 'Review follow-up',
        projectId: 'inbox',
      },
    });

    expect(action.ok).toBe(false);

    const claimA = await store.getNode('sqlite-claim-a');
    expect(claimA.ok).toBe(true);
    if (claimA.ok) {
      expect(claimA.value?.metadata?.['state']).toBe('draft');
    }

    const claimB = await store.getNode('sqlite-claim-b');
    expect(claimB.ok).toBe(true);
    if (claimB.ok) {
      expect(claimB.value?.metadata?.['state']).toBe('draft');
    }

    const tagEdges = await store.getEdges({
      predicate: 'aboutTag',
      subject: 'sqlite-claim-a',
    });
    expect(tagEdges.ok).toBe(true);
    if (tagEdges.ok) {
      expect(tagEdges.value.items.length).toBe(0);
    }

    const tasks = await store.queryNodes({ type: 'Task' });
    expect(tasks.ok).toBe(true);
    if (tasks.ok) {
      expect(tasks.value.items.length).toBe(0);
    }
  });

  it('updates all requested claims together on success', async () => {
    const action = await applyReviewAction(store, {
      claimIds: ['sqlite-claim-a', 'sqlite-claim-b'],
      state: 'accepted',
      tags: ['curated'],
    });

    expect(action.ok).toBe(true);
    if (!action.ok) return;
    expect(action.value.updatedClaims).toBe(2);
    expect(action.value.updatedTags).toBe(2);

    const claimA = await store.getNode('sqlite-claim-a');
    expect(claimA.ok).toBe(true);
    if (claimA.ok) {
      expect(claimA.value?.metadata?.['state']).toBe('accepted');
    }

    const claimB = await store.getNode('sqlite-claim-b');
    expect(claimB.ok).toBe(true);
    if (claimB.ok) {
      expect(claimB.value?.metadata?.['state']).toBe('accepted');
    }
  });
});
