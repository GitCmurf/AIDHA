// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 Colin Farmer (GitCmurf)

import type { MediaSegment } from '../types/index.js';
import type { ExtractionContext } from '../types/index.js';
import type { RawSource } from '../types/index.js';
import type { DecodeOutput } from '../types/index.js';
import type { Locator } from '../types/index.js';
import type { Result } from '@aidha/taxonomy';
import type { TaxonomyRegistry } from '@aidha/taxonomy';
import type { ResolvedConfig } from '@aidha/config';
import type { GraphStore } from '@aidha/graph-backend';
import type { LlmClient } from '../extract/llm-client.js';

export type { MediaSegment, ExtractionContext, RawSource, DecodeOutput, Locator };

export interface IngestInput {
  readonly ref: string;
  readonly metadata?: Record<string, unknown>;
}

export interface AudioRef {
  readonly uri: string;
  readonly mimeType: string;
}

export interface TranscribeOptions {
  language?: string;
  maxTokens?: number;
}

export interface TimecodedSegment {
  id: string;
  startSec: number;
  endSec: number;
  text: string;
  speaker?: string;
}

export interface ChunkInput {
  readonly segments: readonly MediaSegment[];
  readonly context: ExtractionContext;
}

export interface Chunk {
  readonly id: string;
  readonly segments: readonly MediaSegment[];
  readonly text: string;
  readonly locator: Locator;
}

export interface WebFetchInput {
  readonly url: string;
  readonly options?: { followRedirects?: boolean };
}

export interface CostCeiling {
  readonly maxTokens?: number;
  readonly maxSpendUsd?: number;
}

export type Sensitivity = 'public' | 'personal' | 'confidential';
export type LlmRoute = 'cloud' | 'local' | 'disabled';

export interface PrivacyPolicy {
  readonly defaultRoute: LlmRoute;
  readonly routes?: Partial<Record<Sensitivity, LlmRoute>>;
}

export interface DraftClaim {
  readonly id?: string;
  readonly text: string;
  readonly excerptIds: readonly string[];
  readonly state: 'draft';
  readonly confidence?: number;
  readonly type?: string;
  readonly classification?: string;
  readonly metadata?: Record<string, unknown>;
}

export interface SourceSynopsisEvidenceRef {
  readonly excerptId: string;
  readonly locator: Locator;
  readonly localTranscriptRef: string;
  readonly sourceRef?: string;
}

export interface SourceSynopsisItem {
  readonly text: string;
  readonly kind: 'context' | 'workflow' | 'mechanism' | 'pattern' | 'tradeoff' | 'limitation' | 'recommendation';
  readonly evidenceRefs: readonly SourceSynopsisEvidenceRef[];
  readonly attribution?: string;
  readonly rationale?: string;
  readonly entities?: readonly string[];
}

export interface SupportingUnitSummary {
  readonly id: string;
  readonly kind: string;
  readonly text: string;
  readonly supportsUnitIds: readonly string[];
  readonly excerptIds: readonly string[];
}

export interface SourceDistillationSummary {
  readonly failedClosed: boolean;
  readonly sourceType?: string;
  readonly sourcePurpose?: string;
  readonly sourceCoherence?: string;
  readonly theses?: readonly string[];
  readonly coverage?: {
    readonly citedExcerptCount: number;
    readonly excerptsCitedPercent: number;
    readonly citedTextPercent: number;
    readonly largestUncitedGapSeconds: number;
    readonly coreUnitsWithoutVerifiedEvidence: number;
    readonly weakQuoteCount: number;
  };
  readonly unitCountsByKind?: Readonly<Record<string, number>>;
  readonly relations?: readonly { readonly type: string; readonly sourceUnitId: string; readonly targetUnitId: string }[];
  readonly diagnostics: readonly string[];
}

export interface MiningResult {
  readonly claims: readonly DraftClaim[];
  readonly tokenUsage?: number;
  readonly spendUsd?: number;
  /** Distillation path only; chunk-mining path leaves these undefined. */
  readonly rejectedClaims?: readonly DraftClaim[];
  readonly supportingUnits?: readonly SupportingUnitSummary[];
  readonly distillation?: SourceDistillationSummary;
}

export interface ExportResult {
  readonly resourceId: string;
  readonly excerptIds: readonly string[];
  readonly claimIds: readonly string[];
  readonly dedupAction: 'create' | 'merge' | 'corroborate';
  readonly metadataConflictCount: number;
  readonly created: number;
  readonly updated: number;
  readonly noop: number;
}

export interface ReferenceExtractionReport {
  readonly referencesCreated: number;
  readonly referencesUpdated: number;
  readonly referencesNoop: number;
  readonly referenceEdgesCreated: number;
  readonly referenceEdgesUpdated: number;
  readonly referenceEdgesNoop: number;
}

export interface ClassificationRequest {
  readonly raw: RawSource;
  readonly resourceId: string;
  readonly excerptIds: readonly string[];
  readonly claimIds: readonly string[];
  readonly claims: readonly DraftClaim[];
  readonly chunks: readonly Chunk[];
  readonly context: ExtractionContext;
  readonly config: ResolvedConfig;
}

export interface ClassificationResult {
  readonly status: 'completed' | 'disabled';
  readonly tagsMatched: number;
  readonly tagsAssigned: number;
  readonly warnings: readonly string[];
}

export interface ClaimQualitySummary {
  readonly total: number;
  readonly reviewable: number;
  readonly rejected: number;
}

export interface RunReport {
  readonly sourceId: string;
  readonly canonicalId: string;
  readonly resourceId: string;
  readonly excerptCount: number;
  readonly chunkCount: number;
  readonly segmentCount: number;
  readonly segments: readonly MediaSegment[];
  readonly chunks: readonly Chunk[];
  readonly excerptIds: readonly string[];
  readonly claimsExtracted: number;
  readonly claimIds: readonly string[];
  readonly claims: readonly DraftClaim[];
  readonly rejectedClaims: readonly DraftClaim[];
  readonly qualitySummary: ClaimQualitySummary;
  readonly supportingUnits?: readonly SupportingUnitSummary[];
  readonly sourceDistillation?: SourceDistillationSummary;
  readonly sourceSynopsis: readonly SourceSynopsisItem[];
  readonly dedupAction: 'create' | 'merge' | 'corroborate';
  readonly policyRoute: LlmRoute;
  readonly cacheHits: number;
  readonly cacheWrites: number;
  readonly tokenUsage: number;
  readonly spendUsd: number;
  readonly warnings: readonly string[];
  readonly classification: ClassificationResult;
  readonly metadataConflictCount: number;
  readonly references: ReferenceExtractionReport;
  readonly durationMs: number;
}

export type ILLMClient = LlmClient;

export interface ICache {
  get(key: string): Promise<Result<string | null>>;
  set(key: string, value: string): Promise<Result<void>>;
}

export interface Clock {
  now(): Date;
}

export interface VectorRuntimeContext {
  readonly config: ResolvedConfig;
  readonly clock: Clock;
}

export interface IIngestor<TPayload = unknown> {
  readonly sourceId: string;
  acquire(input: IngestInput, runtimeContext: VectorRuntimeContext): Promise<Result<RawSource<TPayload>>>;
}

export interface DecodeInput<TPayload = unknown> {
  readonly raw: RawSource<TPayload>;
  readonly upstream?: readonly MediaSegment[];
  readonly config: ResolvedConfig;
}

export interface IDecodeStrategy<TPayload = unknown> {
  readonly name: string;
  decode(input: DecodeInput<TPayload>): Promise<Result<DecodeOutput>>;
}

export interface IChunker {
  readonly name: string;
  chunk(input: ChunkInput): Promise<Result<Chunk[]>>;
}

export interface MiningRequest {
  readonly raw: RawSource;
  readonly chunks: readonly Chunk[];
  readonly context: ExtractionContext;
  readonly config: ResolvedConfig;
  readonly policyRoute: LlmRoute;
  readonly llm?: LlmClient;
  readonly costCeiling: CostCeiling;
  readonly clock: Clock;
}

export interface ICandidateMiner {
  estimate?(request: MiningRequest): Result<{ readonly tokenUsage: number; readonly spendUsd: number }>;
  mine(request: MiningRequest): Promise<Result<MiningResult>>;
}

export interface IExporter {
  export(miningResult: MiningResult, raw: RawSource, chunks: readonly Chunk[]): Promise<Result<ExportResult>>;
}

export interface IReferenceExtractor {
  extract(resourceId: string): Promise<Result<ReferenceExtractionReport>>;
}

export interface IClassifier {
  classify(request: ClassificationRequest): Promise<Result<ClassificationResult>>;
}

export interface ITranscriber {
  readonly backend: string;
  transcribe(audio: AudioRef, opts: TranscribeOptions): Promise<Result<TimecodedSegment[]>>;
}

export interface IDiarizer {
  readonly backend: string;
  diarize(audio: AudioRef, segments: TimecodedSegment[]): Promise<Result<TimecodedSegment[]>>;
}

export interface IWebFetcher {
  readonly backend: string;
  fetch(input: WebFetchInput): Promise<Result<{ url: string; canonicalUrl: string; inputCanonicalUrl: string; title: string; html: string }>>;
}

export interface IContextProvider<TPayload = unknown> {
  build(raw: RawSource<TPayload>, userConfig: ResolvedConfig): Promise<ExtractionContext>;
}

export interface PipelineServices {
  readonly store: GraphStore;
  readonly miner: ICandidateMiner;
  readonly exporter: IExporter;
  readonly referenceExtractor?: IReferenceExtractor;
  readonly classifier?: IClassifier;
  readonly taxonomyRegistry?: TaxonomyRegistry;
  readonly llm?: LlmClient;
  readonly cache: ICache;
  readonly costCeiling: CostCeiling;
  readonly privacy: PrivacyPolicy;
  readonly clock: Clock;
  readonly config: ResolvedConfig;
  readonly allowHeuristicFallback: boolean;
}
