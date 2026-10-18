import { afterEach, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { InMemoryStore, SQLiteStore } from '@aidha/graph-backend';
import { applyDedupResolution } from '../../src/compose/dedup-link.js';
import {
  getSourceOwnedMetadataGroup,
  mergeSourceOwnedMetadataGroups,
} from '../../src/compose/resource-metadata-groups.js';
import { createRawSource } from '../../src/compose/source-envelope.js';
import type { RawSource, ResourceMetadataGroup } from '../../src/types/index.js';

const directories: string[] = [];
const DESCRIPTION_GROUP: ResourceMetadataGroup = {
  id: 'video-description-evidence',
  fields: ['description', 'creatorNoteCapture', 'creatorNoteCaptureAttempt'],
};

afterEach(async () => {
  for (const directory of directories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

function source(input: {
  readonly canonicalId: string;
  readonly resourceMetadata: Record<string, unknown>;
  readonly resourceMetadataGroups?: readonly ResourceMetadataGroup[];
  readonly dedupKeys?: string[];
}): RawSource {
  return {
    canonicalId: input.canonicalId,
    dedupKeys: input.dedupKeys ?? ['web:video-1'],
    sourceType: 'youtube',
    sensitivity: 'public',
    provenance: {
      sourceUri: `https://example.test/${input.canonicalId}`,
      ingestedAt: '2026-10-18T16:00:00.000Z',
      sourceType: 'youtube',
    },
    payload: {},
    resourceMetadata: input.resourceMetadata,
    ...(input.resourceMetadataGroups ? { resourceMetadataGroups: [...input.resourceMetadataGroups] } : {}),
    label: input.canonicalId,
  };
}

async function seedAlias(store: SQLiteStore | InMemoryStore, metadata: Record<string, unknown> = {}): Promise<void> {
  const seeded = await store.upsertNode('Resource', 'existing-video-alias', {
    label: 'Existing alias',
    metadata: {
      canonicalId: 'existing-video-alias',
      sourceType: 'web',
      dedupKeys: ['web:video-1'],
      provenances: [],
      ...metadata,
    },
  });
  if (!seeded.ok) throw seeded.error;
}

function capture(canonicalId: string, description: string, attemptedAt: string, state: 'success' | 'failed') {
  return {
    description,
    creatorNoteCapture: { sourceCanonicalId: canonicalId, contentSha256: `${canonicalId}-hash` },
    creatorNoteCaptureAttempt: {
      schemaVersion: 1,
      method: 'fixture',
      state,
      attemptedAt,
      ...(state === 'failed' ? { reason: 'timeout' } : {}),
    },
  };
}

it('updates a source-owned group after alias refresh and persists one coherent state', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'aidha-source-owned-metadata-'));
  directories.push(directory);
  const db = join(directory, 'graph.sqlite');
  const aliasId = 'existing-video-alias';
  const canonicalId = 'youtube:video-1';
  const initial = SQLiteStore.open(db);
  try {
    await seedAlias(initial);
    const successful = await applyDedupResolution(initial, source({
      canonicalId,
      resourceMetadataGroups: [DESCRIPTION_GROUP],
      resourceMetadata: capture(canonicalId, 'Last good description', '2026-10-18T16:00:00.000Z', 'success'),
    }));
    if (!successful.ok) throw successful.error;
    expect(successful.value.resourceId).toBe(aliasId);

    const failedRefresh = await applyDedupResolution(initial, source({
      canonicalId,
      resourceMetadataGroups: [DESCRIPTION_GROUP],
      resourceMetadata: {
        creatorNoteCaptureAttempt: {
          schemaVersion: 1,
          method: 'fixture',
          state: 'failed',
          reason: 'timeout',
          attemptedAt: '2026-10-18T16:01:00.000Z',
        },
      },
    }));
    if (!failedRefresh.ok) throw failedRefresh.error;
    expect(failedRefresh.value.resourceId).toBe(aliasId);
  } finally {
    await initial.close();
  }

  const reopened = SQLiteStore.open(db);
  try {
    const resource = await reopened.getNode(aliasId);
    if (!resource.ok || !resource.value) throw new Error('Missing reopened alias Resource');
    expect(resource.value.metadata['description']).toBe('Last good description');
    expect(resource.value.metadata['creatorNoteCapture']).toEqual({
      sourceCanonicalId: canonicalId,
      contentSha256: `${canonicalId}-hash`,
    });
    expect(resource.value.metadata['creatorNoteCaptureAttempt']).toEqual({
      schemaVersion: 1,
      method: 'fixture',
      state: 'failed',
      reason: 'timeout',
      attemptedAt: '2026-10-18T16:01:00.000Z',
    });
    expect(resource.value.metadata['sourceOwnedMetadataGroups']).toEqual({
      schemaVersion: 1,
      groups: {
        [DESCRIPTION_GROUP.id]: {
          canonicalId,
          fields: ['creatorNoteCapture', 'creatorNoteCaptureAttempt', 'description'],
        },
      },
    });

    const exported = await reopened.exportSnapshot();
    if (!exported.ok) throw exported.error;
    expect(exported.value.nodes.find(node => node.id === aliasId)?.metadata).toMatchObject({
      description: 'Last good description',
      creatorNoteCapture: { sourceCanonicalId: canonicalId, contentSha256: `${canonicalId}-hash` },
      creatorNoteCaptureAttempt: { state: 'failed', attemptedAt: '2026-10-18T16:01:00.000Z' },
    });
  } finally {
    await reopened.close();
  }
});

it('rejects a foreign owner patch as a whole and protects owned fields from ungrouped writes', async () => {
  const store = new InMemoryStore();
  await seedAlias(store);
  const original = capture('youtube:video-1', 'Owner A description', '2026-10-18T16:00:00.000Z', 'success');
  const first = await applyDedupResolution(store, source({
    canonicalId: 'youtube:video-1', resourceMetadataGroups: [DESCRIPTION_GROUP], resourceMetadata: original,
  }));
  expect(first.ok).toBe(true);

  const foreign = capture('youtube:video-2', 'Owner B description', '2026-10-18T16:02:00.000Z', 'failed');
  const second = await applyDedupResolution(store, source({
    canonicalId: 'youtube:video-2', resourceMetadataGroups: [DESCRIPTION_GROUP], resourceMetadata: foreign,
  }));
  expect(second.ok).toBe(true);
  expect(second.ok && second.value.metadataConflictCount).toBeGreaterThan(0);

  const resource = await store.getNode('existing-video-alias');
  if (!resource.ok || !resource.value) throw new Error('Missing alias Resource');
  expect(resource.value.metadata['description']).toBe('Owner A description');
  expect(resource.value.metadata['creatorNoteCapture']).toEqual(original.creatorNoteCapture);
  expect(resource.value.metadata['creatorNoteCaptureAttempt']).toEqual(original.creatorNoteCaptureAttempt);
  expect((resource.value.metadata['sourceOwnedMetadataGroups'] as { groups: Record<string, { canonicalId: string }> })
    .groups[DESCRIPTION_GROUP.id]?.canonicalId).toBe('youtube:video-1');

  await expect(applyDedupResolution(store, source({
    canonicalId: 'youtube:video-1',
    resourceMetadata: { description: 'Ungrouped bypass' },
  }))).rejects.toThrow(/declare that group/i);
  const afterBypass = await store.getNode('existing-video-alias');
  if (!afterBypass.ok || !afterBypass.value) throw new Error('Missing alias Resource after rejected bypass');
  expect(afterBypass.value.metadata['description']).toBe('Owner A description');

  const cleared = await applyDedupResolution(store, source({
    canonicalId: 'youtube:video-1',
    resourceMetadataGroups: [DESCRIPTION_GROUP],
    resourceMetadata: { description: null, creatorNoteCapture: null },
  }));
  expect(cleared.ok).toBe(true);
  const afterClear = await store.getNode('existing-video-alias');
  if (!afterClear.ok || !afterClear.value) throw new Error('Missing alias after group clear');
  expect(afterClear.value.metadata['description']).toBeNull();
  expect(afterClear.value.metadata['creatorNoteCapture']).toBeNull();
  expect(afterClear.value.metadata['creatorNoteCaptureAttempt']).toEqual(original.creatorNoteCaptureAttempt);
});

it('does not adopt equal or conflicting populated ownerless alias values', async () => {
  const store = new InMemoryStore();
  const initialDescription = 'Legacy web description';
  await seedAlias(store, { description: initialDescription });

  const result = await applyDedupResolution(store, source({
    canonicalId: 'youtube:video-1',
    resourceMetadataGroups: [DESCRIPTION_GROUP],
    resourceMetadata: capture('youtube:video-1', 'New video description', '2026-10-18T16:00:00.000Z', 'success'),
  }));
  expect(result.ok).toBe(true);
  expect(result.ok && result.value.metadataConflictCount).toBeGreaterThan(0);

  const resource = await store.getNode('existing-video-alias');
  if (!resource.ok || !resource.value) throw new Error('Missing ownerless alias Resource');
  expect(resource.value.metadata['description']).toBe(initialDescription);
  expect(resource.value.metadata['creatorNoteCapture']).toBeUndefined();
  expect(resource.value.metadata['creatorNoteCaptureAttempt']).toBeUndefined();
  expect(resource.value.metadata['sourceOwnedMetadataGroups']).toBeUndefined();

  // Equality is not provenance: an incoming group cannot claim an owner merely
  // because all existing legacy values happen to match it.
  const equalStore = new InMemoryStore();
  const equalValues = capture('youtube:video-1', 'Equal legacy description', '2026-10-18T16:00:00.000Z', 'success');
  await seedAlias(equalStore, equalValues);
  const equalResult = await applyDedupResolution(equalStore, source({
    canonicalId: 'youtube:video-1',
    resourceMetadataGroups: [DESCRIPTION_GROUP],
    resourceMetadata: equalValues,
  }));
  expect(equalResult.ok).toBe(true);
  const equalResource = await equalStore.getNode('existing-video-alias');
  if (!equalResource.ok || !equalResource.value) throw new Error('Missing equal ownerless Resource');
  expect(equalResource.value.metadata['sourceOwnedMetadataGroups']).toBeUndefined();
  expect(equalResource.value.metadata['creatorNoteCaptureAttempt']).toEqual(equalValues.creatorNoteCaptureAttempt);
});

it('adopts an exact-canonical legacy group while retaining omitted last-good members', async () => {
  const store = new InMemoryStore();
  const canonicalId = 'youtube:video-1';
  const legacyCapture = { sourceCanonicalId: canonicalId, contentSha256: 'legacy-hash' };
  const legacyDescription = 'Previously captured canonical description';
  const seeded = await store.upsertNode('Resource', canonicalId, {
    label: 'Canonical video',
    metadata: {
      canonicalId,
      sourceType: 'youtube',
      dedupKeys: [],
      provenances: [],
      description: legacyDescription,
      creatorNoteCapture: legacyCapture,
    },
  });
  if (!seeded.ok) throw seeded.error;

  const result = await applyDedupResolution(store, source({
    canonicalId,
    dedupKeys: [canonicalId],
    resourceMetadataGroups: [DESCRIPTION_GROUP],
    resourceMetadata: {
      creatorNoteCaptureAttempt: {
        schemaVersion: 1,
        method: 'fixture',
        state: 'failed',
        reason: 'timeout',
        attemptedAt: '2026-10-18T16:01:00.000Z',
      },
    },
  }));
  expect(result.ok).toBe(true);
  const resource = await store.getNode(canonicalId);
  if (!resource.ok || !resource.value) throw new Error('Missing exact-canonical Resource');
  expect(resource.value.metadata['description']).toBe(legacyDescription);
  expect(resource.value.metadata['creatorNoteCapture']).toEqual(legacyCapture);
  expect(resource.value.metadata['creatorNoteCaptureAttempt']).toMatchObject({ state: 'failed' });
  expect((resource.value.metadata['sourceOwnedMetadataGroups'] as { groups: Record<string, { canonicalId: string }> })
    .groups[DESCRIPTION_GROUP.id]?.canonicalId).toBe(canonicalId);
});

it('rejects malformed or overlapping groups before writing a Resource', async () => {
  const invalidGroups: ResourceMetadataGroup[][] = [
    [{ id: '', fields: ['field'] }],
    [{ id: 'duplicate-fields', fields: ['field', 'field'] }],
    [{ id: 'reserved-field', fields: ['metadataConflicts'] }],
    [
      { id: 'first', fields: ['shared'] },
      { id: 'second', fields: ['shared'] },
    ],
  ];

  for (const resourceMetadataGroups of invalidGroups) {
    const store = new InMemoryStore();
    await expect(applyDedupResolution(store, source({
      canonicalId: `fixture-${invalidGroups.indexOf(resourceMetadataGroups)}`,
      dedupKeys: [],
      resourceMetadataGroups,
      resourceMetadata: { field: 'value', shared: 'value' },
    }))).rejects.toThrow();
    const resources = await store.queryNodes({ type: 'Resource' });
    expect(resources.ok && resources.value.items).toHaveLength(0);
  }
});

it('rejects field-set changes and cross-group overlap against persisted ownership', async () => {
  const store = new InMemoryStore();
  await seedAlias(store);
  const initial = await applyDedupResolution(store, source({
    canonicalId: 'youtube:video-1',
    resourceMetadataGroups: [{ id: 'group-one', fields: ['description'] }],
    resourceMetadata: { description: 'Owned description' },
  }));
  expect(initial.ok).toBe(true);

  await expect(applyDedupResolution(store, source({
    canonicalId: 'youtube:video-1',
    resourceMetadataGroups: [{ id: 'group-one', fields: ['description', 'title'] }],
    resourceMetadata: { description: 'Changed set', title: 'Title' },
  }))).rejects.toThrow(/cannot change its fields/i);

  await expect(applyDedupResolution(store, source({
    canonicalId: 'youtube:video-2',
    resourceMetadataGroups: [{ id: 'group-two', fields: ['description', 'title'] }],
    resourceMetadata: { description: 'Overlapping set', title: 'Title' },
  }))).rejects.toThrow(/already owned by group/i);

  const resource = await store.getNode('existing-video-alias');
  if (!resource.ok || !resource.value) throw new Error('Missing alias after rejected group changes');
  expect(resource.value.metadata['description']).toBe('Owned description');
  expect(resource.value.metadata['title']).toBeUndefined();
});

it('sanitizes forged ownership metadata from source envelopes', () => {
  const raw = createRawSource({
    canonicalId: 'fixture-source',
    sourceType: 'youtube',
    sensitivity: 'public',
    payload: {},
    label: 'Fixture',
    clock: { now: () => new Date('2026-10-18T16:00:00.000Z') },
    resourceMetadata: {
      sourceOwnedMetadataGroups: { schemaVersion: 1, groups: { forged: { canonicalId: 'fixture-source', fields: ['description'] } } },
      description: 'ordinary value',
    },
  });
  expect(raw.resourceMetadata).toEqual({ description: 'ordinary value' });
});

it('initializes inherited-name fields as absent when a new alias claims a group', () => {
  const group: ResourceMetadataGroup = {
    id: 'constructor-field-group',
    fields: ['description', 'constructor'],
  };
  const result = mergeSourceOwnedMetadataGroups({}, source({
    canonicalId: 'youtube:video-3',
    resourceMetadataGroups: [group],
    resourceMetadata: { description: 'A real description' },
  }), false);

  expect(result.conflicts).toEqual([]);
  expect(result.metadata['description']).toBe('A real description');
  expect(Object.hasOwn(result.metadata, 'constructor')).toBe(true);
  expect(result.metadata['constructor']).toBeNull();
  expect(result.metadata['sourceOwnedMetadataGroups']).toEqual({
    schemaVersion: 1,
    groups: {
      'constructor-field-group': {
        canonicalId: 'youtube:video-3',
        fields: ['constructor', 'description'],
      },
    },
  });
  expect(getSourceOwnedMetadataGroup(result.metadata, 'constructor-field-group')).toEqual({
    canonicalId: 'youtube:video-3',
    fields: ['constructor', 'description'],
  });
  expect(() => getSourceOwnedMetadataGroup({
    sourceOwnedMetadataGroups: { schemaVersion: 2, groups: {} },
  }, 'constructor-field-group')).toThrow(/source-owned Resource metadata groups are invalid/i);
});
