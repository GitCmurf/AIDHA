import { describe, expect, it } from 'vitest';
import { InMemoryStore } from '@aidha/graph-backend';
import {
  buildProjectReentryDossier,
  createActivationTaskFromClaim,
  getActivationReviewQueue,
  getActivationTaskContext,
  renderProjectReentryMarkdown,
  searchActivationClaims,
} from '../../src/activation/index.js';

async function fixtureStore(): Promise<InMemoryStore> {
  const store = new InMemoryStore();
  await store.upsertNode('Resource', 'res-web', {
    label: 'Web Article',
    metadata: { sourceType: 'web', url: 'https://example.com/article' },
  });
  await store.upsertNode('Excerpt', 'exc-web', {
    label: 'Web excerpt',
    content: 'The article says activation should convert knowledge into action.',
    metadata: { resourceId: 'res-web', locator: { kind: 'dom', textFragment: 'activation', charStart: 0, charEnd: 72 } },
  });
  await store.upsertNode('Claim', 'claim-web', {
    label: 'Activation should convert knowledge into action.',
    content: 'Activation should convert knowledge into action.',
    metadata: {
      resourceId: 'res-web',
      state: 'accepted',
      routingReviewStatus: 'unreviewed',
      confidence: 0.62,
    },
  });
  await store.upsertEdge('claim-web', 'claimDerivedFrom', 'exc-web', {});
  return store;
}

describe('activation helpers', () => {
  it('searches claims with source-neutral provenance', async () => {
    const store = await fixtureStore();

    const result = await searchActivationClaims(store, { query: 'activation', states: ['accepted'] });

    expect(result.ok).toBe(true);
    if (!result.ok) throw result.error;
    expect(result.value).toMatchObject([{
      claimId: 'claim-web',
      resourceId: 'res-web',
      sourceType: 'web',
      excerptId: 'exc-web',
      locatorDisplay: { label: 'web fragment' },
    }]);
  });

  it('creates a task from a claim and shows provenance context', async () => {
    const store = await fixtureStore();

    const created = await createActivationTaskFromClaim(store, {
      claimId: 'claim-web',
      title: 'Turn activation claim into implementation',
      projectId: 'project-alpha',
    });
    expect(created.ok).toBe(true);
    if (!created.ok) throw created.error;

    const context = await getActivationTaskContext(store, created.value.taskId);
    expect(context.ok).toBe(true);
    if (!context.ok) throw context.error;
    expect(context.value.project?.id).toBe('project-alpha');
    expect(context.value.claims[0]).toMatchObject({
      claimId: 'claim-web',
      resourceId: 'res-web',
      excerptId: 'exc-web',
    });
  });

  it('reports editorial and routing review as distinct axes', async () => {
    const store = await fixtureStore();
    await store.upsertNode('Claim', 'claim-draft', {
      label: 'Draft claim',
      content: 'Draft claim',
      metadata: { resourceId: 'res-web', state: 'draft', routingReviewStatus: 'confirmed' },
    });
    await store.upsertEdge('claim-draft', 'claimDerivedFrom', 'exc-web', {});

    const result = await getActivationReviewQueue(store);

    expect(result.ok).toBe(true);
    if (!result.ok) throw result.error;
    const byId = new Map(result.value.map(item => [item.claimId, item.reviewAxes]));
    expect(byId.get('claim-web')).toEqual(['routing']);
    expect(byId.get('claim-draft')).toEqual(['editorial']);
  });

  it('builds a project re-entry dossier from task provenance', async () => {
    const store = await fixtureStore();
    const created = await createActivationTaskFromClaim(store, {
      claimId: 'claim-web',
      title: 'Implement activation loop',
      projectId: 'project-alpha',
    });
    expect(created.ok).toBe(true);

    const dossier = await buildProjectReentryDossier(store, 'project-alpha');

    expect(dossier.ok).toBe(true);
    if (!dossier.ok) throw dossier.error;
    expect(dossier.value.tasks).toHaveLength(1);
    expect(dossier.value.claims[0]?.claimId).toBe('claim-web');
    expect(renderProjectReentryMarkdown(dossier.value)).toContain('Project Re-entry: project-alpha');
  });
});
