import type { GraphNode, GraphStore, NodeDataInput } from '@aidha/graph-backend';
import type { Result } from '../pipeline/types.js';
import type { ClaimExtractionResult, ClaimExtractor, ClaimExtractionInput, ClaimCandidate } from './types.js';
import { hashId } from '../utils/ids.js';
import { DEFAULT_CLAIM_STATE } from '../utils/claim-state.js';

export interface ClaimExtractionConfig {
  graphStore: GraphStore;
  extractor?: ClaimExtractor;
}

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

export class HeuristicClaimExtractor implements ClaimExtractor {
  async extractClaims(input: ClaimExtractionInput): Promise<ClaimCandidate[]> {
    const maxClaims = input.maxClaims ?? 20;
    const candidates: ClaimCandidate[] = input.excerpts.flatMap(excerpt => {
      const text = excerpt.content?.trim();
      if (!text) return [];
      const startSeconds = typeof excerpt.metadata?.['start'] === 'number'
        ? (excerpt.metadata?.['start'] as number)
        : undefined;
      return [
        {
          text,
          excerptIds: [excerpt.id],
          confidence: 0.4,
          startSeconds,
          method: 'heuristic',
        },
      ];
    });

    const seen = new Set<string>();
    const unique = candidates.filter(candidate => {
      if (seen.has(candidate.text)) return false;
      seen.add(candidate.text);
      return true;
    });

    return unique.slice(0, maxClaims);
  }
}

export class ClaimExtractionPipeline {
  private graphStore: GraphStore;
  private extractor: ClaimExtractor;

  constructor(config: ClaimExtractionConfig) {
    this.graphStore = config.graphStore;
    this.extractor = config.extractor ?? new HeuristicClaimExtractor();
  }

  async extractClaimsForVideo(
    videoId: string,
    options: { maxClaims?: number } = {}
  ): Promise<Result<ClaimExtractionResult>> {
    const resourceId = `youtube-${videoId}`;
    const resourceResult = await this.graphStore.getNode(resourceId);
    if (!resourceResult.ok) return resourceResult;
    if (!resourceResult.value) {
      return { ok: false, error: new Error(`Resource not found: ${resourceId}`) };
    }

    const excerptsResult = await this.graphStore.queryNodes({
      type: 'Excerpt',
      filters: { resourceId },
    });
    if (!excerptsResult.ok) return excerptsResult;
    const excerpts = excerptsResult.value.items;
    if (excerpts.length === 0) {
      const status = resourceResult.value.metadata?.['transcriptStatus'];
      const error = resourceResult.value.metadata?.['transcriptError'];
      const details = [status ? `status=${status}` : null, error ? `error=${error}` : null]
        .filter(Boolean)
        .join(', ');
      const message = details.length > 0
        ? `No excerpts found for ${resourceId} (${details})`
        : `No excerpts found for ${resourceId}`;
      return { ok: false, error: new Error(message) };
    }

    const candidates = await this.extractor.extractClaims({
      resource: resourceResult.value,
      excerpts,
      maxClaims: options.maxClaims,
    });
    const extractorEditorVersion = this.getExtractorEditorVersion();
    const firstModel = candidates.find(candidate => typeof candidate.model === 'string')?.model;
    const firstPromptVersion = candidates.find(
      candidate => typeof candidate.promptVersion === 'string'
    )?.promptVersion;

    let claimsCreated = 0;
    let claimsUpdated = 0;
    let claimsNoop = 0;
    let edgesCreated = 0;
    let edgesUpdated = 0;
    let edgesNoop = 0;
    const lastClaimRunAt = new Date().toISOString();
    const writeResult = await runAtomically(this.graphStore, async () => {
      for (const claim of candidates) {
        const claimId = hashId('claim', [resourceId, claim.text, ...claim.excerptIds]);
        const label = claim.text.length > 120 ? `${claim.text.slice(0, 117)}...` : claim.text;
        const metadata: Record<string, unknown> = {
          resourceId,
          videoId,
          method: claim.method ?? 'heuristic',
          confidence: claim.confidence ?? 0.4,
          state: claim.state ?? DEFAULT_CLAIM_STATE,
        };
        if (extractorEditorVersion) metadata['editorVersion'] = extractorEditorVersion;
        if (typeof claim.startSeconds === 'number') metadata['startSeconds'] = claim.startSeconds;
        if (claim.type) metadata['type'] = claim.type;
        if (claim.classification) metadata['classification'] = claim.classification;
        if (claim.domain) metadata['domain'] = claim.domain;
        if (claim.why) metadata['why'] = claim.why;
        if (claim.model) metadata['model'] = claim.model;
        if (claim.promptVersion) metadata['promptVersion'] = claim.promptVersion;

        const data: NodeDataInput = {
          label,
          content: claim.text,
          metadata,
        };

        const upsert = await this.graphStore.upsertNode('Claim', claimId, data, { detectNoop: true });
        if (!upsert.ok) return upsert;
        if (upsert.value.created) claimsCreated++;
        else if (upsert.value.updated) claimsUpdated++;
        else if (upsert.value.noop) claimsNoop++;

        for (const excerptId of claim.excerptIds) {
          const edge = await this.graphStore.upsertEdge(
            claimId,
            'claimDerivedFrom',
            excerptId,
            { metadata: { confidence: claim.confidence ?? 0.4 } },
            { detectNoop: true }
          );
          if (!edge.ok) return edge;
          if (edge.value.created) edgesCreated++;
          else if (edge.value.updated) edgesUpdated++;
          else if (edge.value.noop) edgesNoop++;
        }
      }

      const latestResourceResult = await this.graphStore.getNode(resourceId);
      if (!latestResourceResult.ok) return latestResourceResult;
      if (!latestResourceResult.value) {
        return { ok: false, error: new Error(`Resource not found: ${resourceId}`) };
      }

      const existingMetadata = (latestResourceResult.value.metadata ?? {}) as Record<string, unknown>;
      const runMetadata: Record<string, unknown> = {
        ...existingMetadata,
        lastClaimRunAt,
        lastClaimRunCandidates: candidates.length,
        lastClaimRunCreated: claimsCreated,
        lastClaimRunUpdated: claimsUpdated,
        lastClaimRunNoop: claimsNoop,
        lastClaimRunEdgesCreated: edgesCreated,
        lastClaimRunEdgesUpdated: edgesUpdated,
        lastClaimRunEdgesNoop: edgesNoop,
        lastClaimRunExtractor: this.extractor.constructor.name,
      };
      if (extractorEditorVersion) {
        runMetadata['lastClaimRunEditorVersion'] = extractorEditorVersion;
      }
      if (firstModel) {
        runMetadata['lastClaimRunModel'] = firstModel;
      }
      if (firstPromptVersion) {
        runMetadata['lastClaimRunPromptVersion'] = firstPromptVersion;
      }

      const resourceUpdate = await this.graphStore.upsertNode(
        'Resource',
        resourceId,
        {
          label: latestResourceResult.value.label,
          content: latestResourceResult.value.content,
          metadata: runMetadata,
        },
        { detectNoop: true }
      );
      if (!resourceUpdate.ok) return resourceUpdate;
      return { ok: true, value: undefined };
    });
    if (!writeResult.ok) return writeResult;

    return {
      ok: true,
      value: {
        resourceId,
        claimsCreated,
        claimsUpdated,
        claimsNoop,
        edgesCreated,
        edgesUpdated,
        edgesNoop,
      },
    };
  }

  private getExtractorEditorVersion(): 'v1' | 'v2' | undefined {
    const maybeVersioned = this.extractor as Partial<{ getEditorVersion: () => 'v1' | 'v2' }>;
    if (typeof maybeVersioned.getEditorVersion !== 'function') return undefined;
    return maybeVersioned.getEditorVersion();
  }
}

export type { ClaimExtractionInput, ClaimCandidate };
