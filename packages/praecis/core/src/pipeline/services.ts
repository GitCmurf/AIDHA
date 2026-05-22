// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 Colin Farmer (GitCmurf)

import { createHash } from 'node:crypto';
import { InMemoryStore, type GraphStore } from '@aidha/graph-backend';
import type { Result } from '@aidha/taxonomy';
import { applyDedupResolution } from '../compose/dedup-link.js';
import type {
  Chunk,
  Clock,
  DraftClaim,
  EditingResult,
  ExtractionContext,
  ExportResult,
  ICache,
  ICandidateMiner,
  IEditor,
  IExporter,
  MiningResult,
  PipelineServices,
} from '../interfaces/index.js';
import type { RawSource } from '../types/index.js';

function stableId(seed: string): string {
  return createHash('sha256').update(seed).digest('hex').slice(0, 16);
}

export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}

export class MemoryCache implements ICache {
  private readonly values = new Map<string, string>();

  async get(key: string): Promise<Result<string | null>> {
    return { ok: true, value: this.values.get(key) ?? null };
  }

  async set(key: string, value: string): Promise<Result<void>> {
    this.values.set(key, value);
    return { ok: true, value: undefined };
  }
}

export class HeuristicClaimMiner implements ICandidateMiner {
  async mine(chunks: readonly Chunk[], _context: ExtractionContext): Promise<Result<MiningResult>> {
    const claims: DraftClaim[] = [];
    for (const chunk of chunks) {
      const sentence = chunk.text
        .split(/(?<=[.!?])\s+/u)
        .map(part => part.trim())
        .find(part => part.length >= 8);
      if (!sentence) continue;
      claims.push({
        id: `claim:${stableId(`${chunk.id}:${sentence}`)}`,
        text: sentence,
        excerptIds: [chunk.id],
        state: 'draft' as const,
        confidence: 0.55,
        metadata: { method: 'heuristic' },
      });
    }

    return { ok: true, value: { claims, tokenUsage: Math.ceil(chunks.map(chunk => chunk.text).join('\n').length / 4) } };
  }
}

export class PassthroughEditor implements IEditor {
  async edit(miningResult: MiningResult, _context: ExtractionContext): Promise<Result<EditingResult>> {
    return {
      ok: true,
      value: {
        claims: miningResult.claims.map(claim => ({ ...claim, state: 'draft' })),
        tokenUsage: 0,
        spendUsd: 0,
        diagnostics: [],
      },
    };
  }
}

export class GraphPipelineExporter implements IExporter {
  constructor(private readonly store: GraphStore) {}

  async export(editResult: EditingResult, raw: RawSource, chunks: readonly Chunk[]): Promise<Result<ExportResult>> {
    const dedup = await applyDedupResolution(this.store, raw);
    if (!dedup.ok) return dedup;

    const excerptIds: string[] = [];
    const claimIds: string[] = [];
    let created = 0;
    let updated = 0;
    let noop = 0;

    for (const [index, chunk] of chunks.entries()) {
      const excerptId = `${dedup.value.resourceId}:excerpt:${chunk.id}`;
      const result = await this.store.upsertNode(
        'Excerpt',
        excerptId,
        {
          label: chunk.id,
          content: chunk.text,
          metadata: {
            resourceId: dedup.value.resourceId,
            locator: chunk.locator,
            sequence: index,
            ...(chunk.locator.kind === 'timecode' && chunk.locator.speaker ? { speaker: chunk.locator.speaker } : {}),
          },
        },
        { detectNoop: true },
      );
      if (!result.ok) return result;
      if (result.value.created) created += 1;
      if (result.value.updated) updated += 1;
      if (result.value.noop) noop += 1;
      excerptIds.push(excerptId);

      const edge = await this.store.upsertEdge(dedup.value.resourceId, 'resourceHasExcerpt', excerptId, { metadata: {} }, { detectNoop: true });
      if (!edge.ok) return edge;
    }

    for (const claim of editResult.claims) {
      const claimId = claim.id ?? `claim:${stableId(`${dedup.value.resourceId}:${claim.text}`)}`;
      const result = await this.store.upsertNode(
        'Claim',
        claimId,
        {
          label: claim.text.slice(0, 80),
          content: claim.text,
          metadata: {
            ...claim.metadata,
            resourceId: dedup.value.resourceId,
            state: 'draft',
            ...(claim.confidence !== undefined ? { confidence: claim.confidence } : {}),
            ...(claim.type ? { type: claim.type } : {}),
            ...(claim.classification ? { classification: claim.classification } : {}),
          },
        },
        { detectNoop: true },
      );
      if (!result.ok) return result;
      if (result.value.created) created += 1;
      if (result.value.updated) updated += 1;
      if (result.value.noop) noop += 1;
      claimIds.push(claimId);

      for (const excerptId of claim.excerptIds.length > 0 ? claim.excerptIds : excerptIds) {
        const graphExcerptId = excerptId.startsWith(`${dedup.value.resourceId}:excerpt:`)
          ? excerptId
          : `${dedup.value.resourceId}:excerpt:${excerptId}`;
        const edge = await this.store.upsertEdge(claimId, 'claimDerivedFrom', graphExcerptId, { metadata: {} }, { detectNoop: true });
        if (!edge.ok) return edge;
      }
    }

    return {
      ok: true,
      value: {
        resourceId: dedup.value.resourceId,
        excerptIds,
        claimIds,
        dedupAction: dedup.value.action,
        created,
        updated,
        noop,
      },
    };
  }
}

export function createDefaultPipelineServices(overrides: Partial<PipelineServices> = {}): PipelineServices {
  const store = overrides.store ?? new InMemoryStore();
  return {
    store,
    miner: overrides.miner ?? new HeuristicClaimMiner(),
    editor: overrides.editor ?? new PassthroughEditor(),
    exporter: overrides.exporter ?? new GraphPipelineExporter(store),
    cache: overrides.cache ?? new MemoryCache(),
    costCeiling: overrides.costCeiling ?? {},
    privacy: overrides.privacy ?? { defaultRoute: 'local', routes: { confidential: 'local' } },
    clock: overrides.clock ?? new SystemClock(),
    ...(overrides.llm ? { llm: overrides.llm } : {}),
  };
}
