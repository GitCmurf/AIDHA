import type { GraphNode, GraphStore } from '@aidha/graph-backend';
import type { Result } from '../pipeline/types.js';

const CLAIM_RUN_METADATA_KEYS = [
  'lastClaimRunAt',
  'lastClaimRunCandidates',
  'lastClaimRunCreated',
  'lastClaimRunUpdated',
  'lastClaimRunNoop',
  'lastClaimRunEdgesCreated',
  'lastClaimRunEdgesUpdated',
  'lastClaimRunEdgesNoop',
  'lastClaimRunExtractor',
  'lastClaimRunEditorVersion',
  'lastClaimRunModel',
  'lastClaimRunPromptVersion',
] as const;

interface TransactionalStore {
  runInTransaction<T>(work: () => Promise<Result<T>>): Promise<Result<T>>;
}

function hasTransactions(store: GraphStore): store is GraphStore & TransactionalStore {
  return typeof (store as Partial<TransactionalStore>).runInTransaction === 'function';
}

async function runAtomically<T>(
  store: GraphStore,
  work: () => Promise<Result<T>>
): Promise<Result<T>> {
  if (!hasTransactions(store)) {
    return work();
  }
  return store.runInTransaction(work);
}

function stripClaimRunMetadata(resource: GraphNode): { metadata: Record<string, unknown>; changed: boolean } {
  const metadata: Record<string, unknown> = { ...((resource.metadata ?? {}) as Record<string, unknown>) };
  let changed = false;
  for (const key of CLAIM_RUN_METADATA_KEYS) {
    if (key in metadata) {
      delete metadata[key];
      changed = true;
    }
  }
  return { metadata, changed };
}

export interface PurgeClaimsResult {
  resourceId: string;
  deletedClaims: number;
  clearedRunMetadata: boolean;
}

export async function purgeClaimsForVideo(
  store: GraphStore,
  videoId: string
): Promise<Result<PurgeClaimsResult>> {
  const resourceId = `youtube-${videoId}`;
  const resourceResult = await store.getNode(resourceId);
  if (!resourceResult.ok) return resourceResult;
  if (!resourceResult.value) {
    return { ok: false, error: new Error(`Resource not found: ${resourceId}`) };
  }
  const resource = resourceResult.value;

  const claimResult = await store.queryNodes({
    type: 'Claim',
    filters: { resourceId },
  });
  if (!claimResult.ok) return claimResult;

  const claimIds = claimResult.value.items.map(item => item.id);
  const { metadata, changed } = stripClaimRunMetadata(resource);

  return runAtomically(store, async () => {
    for (const claimId of claimIds) {
      const deleted = await store.deleteNode(claimId, { cascade: true });
      if (!deleted.ok) return deleted;
    }

    if (changed) {
      const resourceUpdate = await store.upsertNode(
        'Resource',
        resourceId,
        {
          label: resource.label,
          content: resource.content,
          metadata,
        },
        { detectNoop: true }
      );
      if (!resourceUpdate.ok) return resourceUpdate;
    }

    return {
      ok: true,
      value: {
        resourceId,
        deletedClaims: claimIds.length,
        clearedRunMetadata: changed,
      },
    };
  });
}
