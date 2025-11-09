import type { GraphStore } from '@aidha/graph-backend';
import type { Result } from './types.js';

export interface IngestionStatus {
  videoId: string;
  resourceId: string;
  transcriptStatus: string;
  transcriptLanguage?: string;
  transcriptError?: string;
  excerptCount: number;
  claimCount: number;
  referenceCount: number;
}

export async function getIngestionStatus(
  graphStore: GraphStore,
  videoId: string
): Promise<Result<IngestionStatus>> {
  const resourceId = `youtube-${videoId}`;
  const resourceResult = await graphStore.getNode(resourceId);
  if (!resourceResult.ok) return resourceResult;
  if (!resourceResult.value) {
    return { ok: false, error: new Error(`Resource not found: ${resourceId}`) };
  }

  const metadata = resourceResult.value.metadata ?? {};
  const transcriptStatus = (metadata['transcriptStatus'] as string | undefined) ?? 'unknown';
  const transcriptLanguage = metadata['transcriptLanguage'] as string | undefined;
  const transcriptError = metadata['transcriptError'] as string | undefined;

  const excerptResult = await graphStore.queryNodes({
    type: 'Excerpt',
    filters: { resourceId },
  });
  if (!excerptResult.ok) return excerptResult;

  const claimResult = await graphStore.queryNodes({
    type: 'Claim',
    filters: { resourceId },
  });
  if (!claimResult.ok) return claimResult;

  const referenceResult = await graphStore.queryNodes({
    type: 'Reference',
    filters: { resourceId },
  });
  if (!referenceResult.ok) return referenceResult;

  return {
    ok: true,
    value: {
      videoId,
      resourceId,
      transcriptStatus,
      transcriptLanguage,
      transcriptError,
      excerptCount: excerptResult.value.items.length,
      claimCount: claimResult.value.items.length,
      referenceCount: referenceResult.value.items.length,
    },
  };
}
