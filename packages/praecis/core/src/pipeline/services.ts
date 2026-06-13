// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 Colin Farmer (GitCmurf)

import { createHash } from 'node:crypto';
import { CURRENT_GRAPH_SCHEMA_VERSION, InMemoryStore, type GraphNode, type GraphStore } from '@aidha/graph-backend';
import { InMemoryRegistry, type Result, type TaxonomyRegistry } from '@aidha/taxonomy';
import {
  CreateCategoryInput,
  CreateTagInput,
  CreateTopicInput,
  TagAssignment,
  type Category,
  type CreateAssignmentInput,
  type Tag,
  type Topic,
  type UpdateCategoryInput,
  type UpdateTagInput,
  type UpdateTopicInput,
} from '@aidha/taxonomy';
import type { ResolvedConfig } from '@aidha/config';
import { applyDedupResolution } from '../compose/dedup-link.js';
import { readTaxonomyAssignmentsResult, withTaxonomyAssignment, withoutTaxonomyAssignment } from './taxonomy-metadata.js';
import {
  createLlmClientFromConfig,
  DEFAULT_COST_PER_1K_TOKENS,
  estimateCost,
  estimateTokens,
  LlmClaimExtractor,
} from '../extract/index.js';
import { SourceDistillationMiner } from '../extract/distill/miner.js';
import type { ExtractionIntent } from '../extract/distill/projection.js';
import { ReferenceExtractionPipeline } from '../extract/references.js';
import type {
  Chunk,
  Clock,
  DraftClaim,
  ExtractionContext,
  ExportResult,
  ICache,
  IClassifier,
  ICandidateMiner,
  IExporter,
  IReferenceExtractor,
  ClassificationRequest,
  ClassificationResult,
  MiningRequest,
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
  clock: Clock,
): GraphNode {
  const now = clock.now().toISOString();
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
    request.clock,
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
    request.clock,
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
      ...(claim.supportSummary ? { supportSummary: claim.supportSummary } : {}),
      ...(claim.rationale ? { rationale: claim.rationale } : {}),
      ...(claim.evidenceType ? { evidenceType: claim.evidenceType } : {}),
      ...(claim.chunkIndex !== undefined ? { chunkIndex: claim.chunkIndex } : {}),
      ...(claim.model ? { model: claim.model } : {}),
      ...(claim.promptVersion ? { promptVersion: claim.promptVersion } : {}),
      ...(claim.extractorVersion ? { extractorVersion: claim.extractorVersion } : {}),
      ...(claim.qualityStatus !== undefined ? { qualityStatus: claim.qualityStatus } : {}),
      ...(claim.qualityReasons !== undefined ? { qualityReasons: claim.qualityReasons } : {}),
      ...(claim.qualityScore !== undefined ? { qualityScore: claim.qualityScore } : {}),
      ...(claim.trusted !== undefined ? { trusted: claim.trusted } : {}),
      ...(claim.supportCoverage !== undefined ? { supportCoverage: claim.supportCoverage } : {}),
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

export interface MinerSelectionOptions {
  readonly extractionIntent?: ExtractionIntent;
  readonly allowPartial?: boolean;
}

/**
 * Temporary toggle for the AIDHA-PLAN-010 comparison checkpoint.
 * AIDHA_EXTRACTION_PATH=chunk-mining selects the legacy path; the toggle and
 * the legacy miners are deleted after the r9 comparison passes (AIDHA-TASK-012 Task 14).
 */
export function selectCandidateMiner(
  env: Record<string, string | undefined>,
  options: MinerSelectionOptions = {},
): ICandidateMiner {
  if (env['AIDHA_EXTRACTION_PATH'] === 'chunk-mining') {
    return new CanonicalLlmClaimMiner();
  }
  return new SourceDistillationMiner({
    ...(options.extractionIntent ? { extractionIntent: options.extractionIntent } : {}),
    ...(options.allowPartial !== undefined ? { allowPartial: options.allowPartial } : {}),
  });
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

export class GraphPipelineExporter implements IExporter {
  constructor(private readonly store: GraphStore) {}

  async export(miningResult: MiningResult, raw: RawSource, chunks: readonly Chunk[]): Promise<Result<ExportResult>> {
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

    for (const claim of miningResult.claims) {
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
        metadataConflictCount: dedup.value.metadataConflictCount,
        created,
        updated,
        noop,
      },
    };
  }
}

export class GraphReferenceExtractor implements IReferenceExtractor {
  private readonly pipeline: ReferenceExtractionPipeline;

  constructor(store: GraphStore) {
    this.pipeline = new ReferenceExtractionPipeline({ graphStore: store });
  }

  extract(resourceId: string) {
    return this.pipeline.extract(resourceId);
  }
}

function normalizeForMatch(value: string): string {
  return value.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

function matchNeedle(haystack: string, needle: string): boolean {
  const normalizedNeedle = normalizeForMatch(needle);
  if (!normalizedNeedle) return false;
  return ` ${haystack} `.includes(` ${normalizedNeedle} `);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function taxonomyExtensionFromConfig(config: ResolvedConfig): Record<string, unknown> | undefined {
  const merged: Record<string, unknown> = {};
  for (const scope of [config.extensions?.global, config.extensions?.source, config.extensions?.profile]) {
    const taxonomy = scope?.['taxonomy'];
    if (isRecord(taxonomy)) {
      Object.assign(merged, taxonomy);
    }
  }
  return Object.keys(merged).length > 0 ? merged : undefined;
}

type TaxonomySeedKey = 'categories' | 'topics' | 'tags';
type TaxonomySeedScope = 'global' | 'source' | 'profile';

interface TaxonomySeedScopeEntry {
  readonly name: TaxonomySeedScope;
  readonly value?: Record<string, unknown>;
}

function zodErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function mergeById<T extends { id: string }>(
  scopes: readonly TaxonomySeedScopeEntry[],
  key: TaxonomySeedKey,
  parse: (value: unknown) => T,
): Result<T[]> {
  const values = new Map<string, T>();
  for (const scope of scopes) {
    const taxonomy = scope.value?.['taxonomy'];
    if (!isRecord(taxonomy)) continue;
    const entries = taxonomy[key];
    if (!Array.isArray(entries)) continue;
    for (const [index, entry] of entries.entries()) {
      try {
        const parsed = parse(entry);
        values.set(parsed.id, parsed);
      } catch (error) {
        const id = isRecord(entry) && typeof entry['id'] === 'string' ? ` id="${entry['id']}"` : '';
        return {
          ok: false,
          error: new Error(`Invalid taxonomy ${key} entry at ${scope.name}.${key}[${index}]${id}: ${zodErrorMessage(error)}`),
        };
      }
    }
  }
  return { ok: true, value: Array.from(values.values()) };
}

export class GraphBackedTaxonomyRegistry implements TaxonomyRegistry {
  constructor(
    private readonly vocabulary: TaxonomyRegistry,
    private readonly store: GraphStore,
    private readonly clock: Clock = new SystemClock(),
  ) {}

  addCategory(input: CreateCategoryInput): Promise<Result<Category>> {
    return this.vocabulary.addCategory(input);
  }

  getCategory(id: string): Promise<Result<Category | null>> {
    return this.vocabulary.getCategory(id);
  }

  updateCategory(id: string, input: UpdateCategoryInput): Promise<Result<Category>> {
    return this.vocabulary.updateCategory(id, input);
  }

  deleteCategory(id: string): Promise<Result<void>> {
    return this.vocabulary.deleteCategory(id);
  }

  listCategories(parentId?: string): Promise<Result<Category[]>> {
    return this.vocabulary.listCategories(parentId);
  }

  addTopic(input: CreateTopicInput): Promise<Result<Topic>> {
    return this.vocabulary.addTopic(input);
  }

  getTopic(id: string): Promise<Result<Topic | null>> {
    return this.vocabulary.getTopic(id);
  }

  updateTopic(id: string, input: UpdateTopicInput): Promise<Result<Topic>> {
    return this.vocabulary.updateTopic(id, input);
  }

  deleteTopic(id: string): Promise<Result<void>> {
    return this.vocabulary.deleteTopic(id);
  }

  listTopics(categoryId?: string): Promise<Result<Topic[]>> {
    return this.vocabulary.listTopics(categoryId);
  }

  addTag(input: CreateTagInput): Promise<Result<Tag>> {
    return this.vocabulary.addTag(input);
  }

  getTag(id: string): Promise<Result<Tag | null>> {
    return this.vocabulary.getTag(id);
  }

  updateTag(id: string, input: UpdateTagInput): Promise<Result<Tag>> {
    return this.vocabulary.updateTag(id, input);
  }

  deleteTag(id: string): Promise<Result<void>> {
    return this.vocabulary.deleteTag(id);
  }

  listTags(topicId?: string): Promise<Result<Tag[]>> {
    return this.vocabulary.listTags(topicId);
  }

  findTagByAlias(alias: string): Promise<Result<Tag | null>> {
    return this.vocabulary.findTagByAlias(alias);
  }

  async assignTag(input: CreateAssignmentInput): Promise<Result<TagAssignment>> {
    try {
      const resource = await this.store.getNode(input.nodeId);
      if (!resource.ok) return resource;
      if (!resource.value) {
        return { ok: false, error: new Error(`Cannot assign taxonomy tag; node not found: ${input.nodeId}`) };
      }
      const assignment = TagAssignment.parse({
        ...input,
        confidence: input.confidence ?? 1,
        source: input.source ?? 'manual',
        assignedAt: this.clock.now().toISOString(),
      });
      const metadata = withTaxonomyAssignment({ ...(resource.value.metadata ?? {}) }, assignment);

      const updated = await this.store.upsertNode(
        resource.value.type,
        resource.value.id,
        {
          label: resource.value.label,
          ...(resource.value.content !== undefined ? { content: resource.value.content } : {}),
          metadata,
        },
        { detectNoop: true },
      );
      if (!updated.ok) return { ok: false, error: updated.error };
      return { ok: true, value: assignment };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error : new Error(String(error)) };
    }
  }

  async getAssignments(nodeId: string): Promise<Result<TagAssignment[]>> {
    const resource = await this.store.getNode(nodeId);
    if (!resource.ok) return resource;
    if (!resource.value) return { ok: true, value: [] };
    const assignmentsResult = readTaxonomyAssignmentsResult(resource.value.metadata ?? {});
    if (!assignmentsResult.ok) return assignmentsResult;
    const assignments = assignmentsResult.value
      .filter(assignment => assignment.nodeId === nodeId)
      .sort((a, b) => a.tagId.localeCompare(b.tagId));
    return { ok: true, value: assignments };
  }

  async removeAssignment(nodeId: string, tagId: string): Promise<Result<void>> {
    const resource = await this.store.getNode(nodeId);
    if (!resource.ok) return resource;
    if (!resource.value) return { ok: true, value: undefined };
    let metadata: Record<string, unknown>;
    try {
      metadata = withoutTaxonomyAssignment({ ...(resource.value.metadata ?? {}) }, nodeId, tagId);
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error : new Error(String(error)) };
    }
    const updated = await this.store.upsertNode(
      resource.value.type,
      resource.value.id,
      {
        label: resource.value.label,
        ...(resource.value.content !== undefined ? { content: resource.value.content } : {}),
        metadata,
      },
      { detectNoop: true },
    );
    if (!updated.ok) return { ok: false, error: updated.error };
    return { ok: true, value: undefined };
  }

  close(): Promise<void> {
    return this.vocabulary.close();
  }
}

export async function createTaxonomyRegistryFromConfig(
  config: ResolvedConfig,
  options: { readonly store?: GraphStore; readonly clock?: Clock } = {},
): Promise<Result<TaxonomyRegistry | undefined>> {
  if (!taxonomyExtensionFromConfig(config)) {
    return { ok: true, value: undefined };
  }

  const scopes: TaxonomySeedScopeEntry[] = [
    { name: 'global', value: config.extensions?.global },
    { name: 'source', value: config.extensions?.source },
    { name: 'profile', value: config.extensions?.profile },
  ];
  const vocabulary = new InMemoryRegistry();
  const categories = mergeById<CreateCategoryInput>(scopes, 'categories', value => CreateCategoryInput.parse(value));
  if (!categories.ok) return categories;
  const topics = mergeById<CreateTopicInput>(scopes, 'topics', value => CreateTopicInput.parse(value));
  if (!topics.ok) return topics;
  const tags = mergeById<CreateTagInput>(scopes, 'tags', value => CreateTagInput.parse(value));
  if (!tags.ok) return tags;

  for (const category of categories.value) {
    const result = await vocabulary.addCategory(category);
    if (!result.ok) return result;
  }
  for (const topic of topics.value) {
    const result = await vocabulary.addTopic(topic);
    if (!result.ok) return result;
  }
  for (const tag of tags.value) {
    const result = await vocabulary.addTag(tag);
    if (!result.ok) return result;
  }

  return { ok: true, value: options.store ? new GraphBackedTaxonomyRegistry(vocabulary, options.store, options.clock) : vocabulary };
}

export async function createConfiguredPipelineServices(overrides: Partial<PipelineServices> = {}, minerOptions: MinerSelectionOptions = {}): Promise<Result<PipelineServices>> {
  const store = overrides.store ?? new InMemoryStore();
  const config = overrides.config ?? defaultResolvedConfig();
  const clock = overrides.clock ?? new SystemClock();
  const registry = overrides.taxonomyRegistry
    ? { ok: true as const, value: overrides.taxonomyRegistry }
    : await createTaxonomyRegistryFromConfig(config, { store, clock });
  if (!registry.ok) return registry;
  return { ok: true, value: createDefaultPipelineServices({
    ...overrides,
    store,
    config,
    clock,
    ...(registry.value ? { taxonomyRegistry: registry.value } : {}),
  }, minerOptions) };
}

export class KeywordTaxonomyClassifier implements IClassifier {
  constructor(private readonly registry: TaxonomyRegistry) {}

  async classify(request: ClassificationRequest): Promise<Result<ClassificationResult>> {
    const tags = await this.registry.listTags();
    if (!tags.ok) return tags;

    const text = normalizeForMatch([
      request.raw.label,
      request.context.sourceSummary ?? '',
      ...request.chunks.map(chunk => chunk.text),
      ...request.claims.map(claim => claim.text),
    ].join('\n'));

    const existingAssignments = await this.registry.getAssignments(request.resourceId);
    if (!existingAssignments.ok) return existingAssignments;
    const existingTagIds = new Set(existingAssignments.value.map(assignment => assignment.tagId));
    const taxonomyVersion = createHash('sha256')
      .update(tags.value.map(tag => `${tag.id}:${tag.name}:${tag.aliases.join(',')}`).sort().join('|'))
      .digest('hex')
      .slice(0, 16);

    let tagsMatched = 0;
    let tagsAssigned = 0;
    for (const tag of tags.value) {
      const terms = [tag.name, ...tag.aliases];
      if (!terms.some(term => matchNeedle(text, term))) continue;
      tagsMatched += 1;
      if (existingTagIds.has(tag.id)) continue;

      const assigned = await this.registry.assignTag({
        nodeId: request.resourceId,
        tagId: tag.id,
        confidence: 0.7,
        source: 'automatic',
        taxonomyVersion,
        assignedBy: 'praecis-keyword-classifier',
      });
      if (!assigned.ok) return assigned;
      existingTagIds.add(tag.id);
      tagsAssigned += 1;
    }

    return { ok: true, value: { status: 'completed', tagsMatched, tagsAssigned, warnings: [] } };
  }
}

/**
 * Low-level default service factory for core tests and internal runtime assembly.
 *
 * Production callers should use createConfiguredPipelineServices() or
 * createIngestionRuntime() so taxonomy configuration and durable assignment
 * persistence are wired consistently.
 */
export function createDefaultPipelineServices(overrides: Partial<PipelineServices> = {}, minerOptions: MinerSelectionOptions = {}): PipelineServices {
  const store = overrides.store ?? new InMemoryStore();
  const config = overrides.config ?? defaultResolvedConfig();
  const configuredClient = config.llm.model && config.llm.baseUrl ? createLlmClientFromConfig(config.llm) : undefined;
  const llm = overrides.llm ?? (configuredClient?.ok ? configuredClient.value : undefined);
  const allowHeuristicFallback = overrides.allowHeuristicFallback ?? false;
  return {
    store,
    miner: overrides.miner ?? (llm ? selectCandidateMiner(process.env, minerOptions) : allowHeuristicFallback ? new HeuristicClaimMiner() : new MissingLlmClaimMiner()),
    exporter: overrides.exporter ?? new GraphPipelineExporter(store),
    ...(overrides.referenceExtractor
      ? { referenceExtractor: overrides.referenceExtractor }
      : overrides.exporter ? {} : { referenceExtractor: new GraphReferenceExtractor(store) }),
    ...(overrides.classifier ? { classifier: overrides.classifier } : overrides.taxonomyRegistry ? { classifier: new KeywordTaxonomyClassifier(overrides.taxonomyRegistry) } : {}),
    ...(overrides.taxonomyRegistry ? { taxonomyRegistry: overrides.taxonomyRegistry } : {}),
    cache: overrides.cache ?? new MemoryCache(),
    costCeiling: overrides.costCeiling ?? {},
    privacy: overrides.privacy ?? { defaultRoute: 'local', routes: { confidential: 'local' } },
    clock: overrides.clock ?? new SystemClock(),
    config,
    allowHeuristicFallback,
    ...(llm ? { llm } : {}),
  };
}
