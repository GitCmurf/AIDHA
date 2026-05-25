// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 Colin Farmer (GitCmurf)

import { createHash } from 'node:crypto';
import { CURRENT_GRAPH_SCHEMA_VERSION, InMemoryStore, type GraphNode, type GraphStore } from '@aidha/graph-backend';
import type { Result } from '@aidha/taxonomy';
import type { ResolvedConfig } from '@aidha/config';
import { applyDedupResolution } from '../compose/dedup-link.js';
import {
  createLlmClientFromConfig,
  DEFAULT_COST_PER_1K_TOKENS,
  estimateCost,
  estimateTokens,
  LlmClaimExtractor,
} from '../extract/index.js';
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
  MiningRequest,
  MiningResult,
  PipelineServices,
  EditingRequest,
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

function defaultResolvedConfig(): ResolvedConfig {
  return {
    baseDir: process.cwd(),
    db: './out/aidha.sqlite',
    llm: {
      model: '',
      apiKey: '',
      baseUrl: '',
      timeoutMs: 30_000,
      cacheDir: './out/cache/claims',
      reasoningEffort: 'medium',
      verbosity: 'medium',
      embeddingBatchSize: 20,
      embeddingTaskType: 'SEMANTIC_SIMILARITY',
      embeddingOutputDimensionality: 768,
    },
    editor: {
      version: 'v2',
      windowMinutes: 5,
      maxPerWindow: 3,
      minWindows: 4,
      minWords: 8,
      minChars: 50,
      editorLlm: false,
    },
    extraction: {
      maxClaims: 15,
      chunkMinutes: 5,
      maxChunks: 0,
      promptVersion: 'v1',
    },
    export: {
      outDir: './out',
      sourcePrefix: '',
    },
  };
}

function estimateChunkBudget(chunks: readonly Chunk[]): { readonly tokenUsage: number; readonly spendUsd: number } {
  const tokenUsage = estimateTokens(chunks.map(chunk => chunk.text).join('\n\n'));
  return { tokenUsage, spendUsd: estimateCost(tokenUsage, DEFAULT_COST_PER_1K_TOKENS) };
}

function graphNode(
  id: string,
  type: GraphNode['type'],
  label: string,
  content: string | undefined,
  metadata: Record<string, unknown>,
): GraphNode {
  const now = new Date(0).toISOString();
  return {
    schemaVersion: CURRENT_GRAPH_SCHEMA_VERSION,
    id,
    type,
    label,
    ...(content !== undefined ? { content } : {}),
    metadata,
    createdAt: now,
    updatedAt: now,
  };
}

function resourceFromRequest(request: MiningRequest): GraphNode {
  return graphNode(
    request.raw.canonicalId,
    'Resource',
    request.raw.label ?? request.raw.canonicalId,
    undefined,
    {
      canonicalId: request.raw.canonicalId,
      sourceType: request.raw.sourceType,
      sensitivity: request.raw.sensitivity,
      policyRoute: request.policyRoute,
      ...(request.context.sourceSummary ? { sourceSummary: request.context.sourceSummary } : {}),
    },
  );
}

function excerptsFromRequest(request: MiningRequest): GraphNode[] {
  return request.chunks.map((chunk, index) => graphNode(
    chunk.id,
    'Excerpt',
    chunk.id,
    chunk.text,
    {
      resourceId: request.raw.canonicalId,
      locator: chunk.locator,
      sequence: index,
      ...(chunk.locator.kind === 'timecode' ? { start: chunk.locator.startSec, end: chunk.locator.endSec } : {}),
      ...(chunk.locator.kind === 'timecode' && chunk.locator.speaker ? { speaker: chunk.locator.speaker } : {}),
      sourceSummary: request.context.sourceSummary,
    },
  ));
}

function claimToDraft(claim: import('../extract/index.js').ClaimCandidate): DraftClaim {
  return {
    text: claim.text,
    excerptIds: claim.excerptIds,
    state: 'draft',
    ...(claim.confidence !== undefined ? { confidence: claim.confidence } : {}),
    ...(claim.type ? { type: claim.type } : {}),
    ...(claim.classification ? { classification: claim.classification } : {}),
    metadata: {
      method: claim.method ?? 'llm',
      ...(claim.domain ? { domain: claim.domain } : {}),
      ...(claim.why ? { why: claim.why } : {}),
      ...(claim.evidenceType ? { evidenceType: claim.evidenceType } : {}),
      ...(claim.chunkIndex !== undefined ? { chunkIndex: claim.chunkIndex } : {}),
      ...(claim.model ? { model: claim.model } : {}),
      ...(claim.promptVersion ? { promptVersion: claim.promptVersion } : {}),
      ...(claim.extractorVersion ? { extractorVersion: claim.extractorVersion } : {}),
      ...(claim.echoOverlapRatio !== undefined ? { echoOverlapRatio: claim.echoOverlapRatio } : {}),
    },
  };
}

export class MissingLlmClaimMiner implements ICandidateMiner {
  estimate(request: MiningRequest): Result<{ readonly tokenUsage: number; readonly spendUsd: number }> {
    return { ok: true, value: estimateChunkBudget(request.chunks) };
  }

  async mine(): Promise<Result<MiningResult>> {
    return { ok: false, error: new Error('LLM extractor is required; pass PipelineServices.llm or enable explicit heuristic fallback') };
  }
}

export class CanonicalLlmClaimMiner implements ICandidateMiner {
  estimate(request: MiningRequest): Result<{ readonly tokenUsage: number; readonly spendUsd: number }> {
    return { ok: true, value: estimateChunkBudget(request.chunks) };
  }

  async mine(request: MiningRequest): Promise<Result<MiningResult>> {
    if (!request.llm) {
      return { ok: false, error: new Error('LLM extractor is required; PipelineServices.llm is missing') };
    }
    if (!request.config.llm.model) {
      return { ok: false, error: new Error('LLM extractor is required; config.llm.model is missing') };
    }

    const extractor = new LlmClaimExtractor({
      client: request.llm,
      model: request.config.llm.model,
      promptVersion: request.config.extraction.promptVersion || 'v1',
      ...(request.config.extraction.chunkMinutes > 0 ? { chunkMinutes: request.config.extraction.chunkMinutes } : {}),
      ...(request.config.extraction.maxChunks > 0 ? { maxChunks: request.config.extraction.maxChunks } : {}),
      ...(request.config.extraction.maxClaims > 0 ? { maxClaims: request.config.extraction.maxClaims } : {}),
      ...(request.config.llm.cacheDir ? { cacheDir: request.config.llm.cacheDir } : {}),
      editorVersion: request.config.editor.version === 'v2' ? 'v2' : 'v1',
      ...(request.config.editor.windowMinutes > 0 ? { editorWindowMinutes: request.config.editor.windowMinutes } : {}),
      ...(request.config.editor.maxPerWindow > 0 ? { editorMaxPerWindow: request.config.editor.maxPerWindow } : {}),
      ...(request.config.editor.minWindows > 0 ? { editorMinWindows: request.config.editor.minWindows } : {}),
      ...(request.config.editor.minWords > 0 ? { editorMinWords: request.config.editor.minWords } : {}),
      ...(request.config.editor.minChars > 0 ? { editorMinChars: request.config.editor.minChars } : {}),
      editorLlm: request.config.editor.editorLlm,
      reasoningEffort: request.config.llm.reasoningEffort,
      verbosity: request.config.llm.verbosity,
    });
    const claims = await extractor.extractClaims({
      resource: resourceFromRequest(request),
      excerpts: excerptsFromRequest(request),
      maxClaims: request.config.extraction.maxClaims > 0 ? request.config.extraction.maxClaims : undefined,
    });
    const usage = extractor.getLastRunStats().actualTokenUsage;
    const spendUsd = extractor.getLastRunStats().actualSpendUsd;
    return {
      ok: true,
      value: {
        claims: claims.map(claimToDraft),
        tokenUsage: usage.totalTokens,
        spendUsd,
      },
    };
  }
}

export class HeuristicClaimMiner implements ICandidateMiner {
  estimate(request: MiningRequest): Result<{ readonly tokenUsage: number; readonly spendUsd: number }> {
    return { ok: true, value: estimateChunkBudget(request.chunks) };
  }

  async mine(request: MiningRequest): Promise<Result<MiningResult>> {
    const claims: DraftClaim[] = [];
    for (const chunk of request.chunks) {
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

    return { ok: true, value: { claims, tokenUsage: Math.ceil(request.chunks.map(chunk => chunk.text).join('\n').length / 4) } };
  }
}

export class PassthroughEditor implements IEditor {
  estimate(): Result<{ readonly tokenUsage: number; readonly spendUsd: number }> {
    return { ok: true, value: { tokenUsage: 0, spendUsd: 0 } };
  }

  async edit(request: EditingRequest): Promise<Result<EditingResult>> {
    return {
      ok: true,
      value: {
        claims: request.miningResult.claims.map(claim => ({ ...claim, state: 'draft' })),
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
            ...(raw.sourceType === 'youtube' ? { videoId: raw.canonicalId.replace(/^youtube-/, '') } : {}),
            ...(chunk.locator.kind === 'timecode' ? {
              start: chunk.locator.startSec,
              end: chunk.locator.endSec,
              duration: Math.max(0, chunk.locator.endSec - chunk.locator.startSec),
            } : {}),
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
  const config = overrides.config ?? defaultResolvedConfig();
  const configuredClient = config.llm.model && config.llm.baseUrl ? createLlmClientFromConfig(config.llm) : undefined;
  const llm = overrides.llm ?? (configuredClient?.ok ? configuredClient.value : undefined);
  const allowHeuristicFallback = overrides.allowHeuristicFallback ?? false;
  return {
    store,
    miner: overrides.miner ?? (llm ? new CanonicalLlmClaimMiner() : allowHeuristicFallback ? new HeuristicClaimMiner() : new MissingLlmClaimMiner()),
    editor: overrides.editor ?? new PassthroughEditor(),
    exporter: overrides.exporter ?? new GraphPipelineExporter(store),
    cache: overrides.cache ?? new MemoryCache(),
    costCeiling: overrides.costCeiling ?? {},
    privacy: overrides.privacy ?? { defaultRoute: 'local', routes: { confidential: 'local' } },
    clock: overrides.clock ?? new SystemClock(),
    config,
    allowHeuristicFallback,
    ...(llm ? { llm } : {}),
  };
}
