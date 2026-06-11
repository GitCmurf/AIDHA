import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { serializeJsonLd, SQLiteStore, toJsonLd } from '@aidha/graph-backend';
import {
  formatProvenance,
  loadConfig,
  resolveConfig,
  resolveKeyProvenance,
  ConfigNotFoundError,
} from '@aidha/config';
import type { LoadResult, ResolvedConfig, SourceRegistration } from '@aidha/config';
import {
  createYouTubeVectorSpec,
  MockYouTubeClient,
  RealYouTubeClient,
  YouTubeSourceRegistration,
  runYouTubePlaylistIngestion,
  type ResolvedYoutubeConfig,
  type YouTubeClient,
} from '@aidha/ingestion-youtube';
import {
  createWebVectorSpec,
  WebSourceRegistration,
} from '@aidha/praecis-source-web';
import {
  createPdfVectorSpec,
  PdfSourceRegistration,
} from '@aidha/praecis-source-pdf';
import {
  createVoiceVectorSpec,
  VoiceSourceRegistration,
} from '@aidha/praecis-source-voice';
import {
  createMeetingVectorSpec,
  MeetingSourceRegistration,
} from '@aidha/praecis-source-meetings';
import {
  createRssVectorSpec,
  RssSourceRegistration,
  createPodcastVectorSpec,
  PodcastSourceRegistration,
  type PodcastFetchFn,
} from '@aidha/praecis-source-feeds';
import {
  createReadwiseVectorSpec,
  ReadwiseSourceRegistration,
  fetchReadwiseExport,
  type ReadwiseFetchFn,
  type ReadwiseBook,
} from '@aidha/praecis-source-readwise';
import {
  runEmailBatch,
  runEmailBatchWithContext,
  EmailSourceRegistration,
  type EmailBatchSummary,
} from '@aidha/praecis-source-email';
import {
  createLinkedInVectorSpec,
  LinkedInSourceRegistration,
} from '@aidha/praecis-source-linkedin';
import {
  buildProjectReentryDossier,
  createActivationTaskFromClaim,
  createConfiguredPipelineServices,
  createIngestionRuntimeFromServices,
  formatTaskContext,
  getActivationReviewQueue,
  getActivationTaskContext,
  getRationaleTrace,
  listRationaleTraces,
  rejectRationaleTrace,
  renderProjectReentryMarkdown,
  runBatch,
  searchActivationClaims,
  type BatchOutcome,
  type ClassificationResult,
  type ComposedVector,
  type LlmClient,
  type PipelineServices,
  type Result,
  type RunReport,
} from '@aidha/praecis-core';
import type { Chunk, Locator, MediaSegment } from '@aidha/praecis-core';

import { createCliUsageText } from './help.js';

export interface CliOptions {
  [key: string]: string | boolean | undefined;
}

export interface IngestSummary {
  readonly sourceId: 'youtube' | 'web' | 'pdf' | 'voice' | 'meeting' | 'rss' | 'podcast' | 'readwise' | 'email' | 'linkedin';
  readonly ref: string;
  readonly canonicalId: string;
  readonly label?: string;
  readonly segmentCount: number;
  readonly chunkCount: number;
  readonly claimsExtracted: number;
  readonly claimIds: readonly string[];
  readonly claims: Array<{
    readonly text: string;
    readonly excerptIds: readonly string[];
    readonly type?: string;
    readonly classification?: string;
    readonly domain?: unknown;
    readonly confidence?: number;
    readonly supportSummary?: unknown;
    readonly rationale?: unknown;
    readonly evidenceType?: unknown;
    readonly qualityStatus?: unknown;
    readonly qualityReasons?: unknown;
    readonly qualityScore?: unknown;
    readonly trusted?: unknown;
    readonly supportCoverage?: unknown;
    readonly evidence: Array<{
      readonly excerptId: string;
      readonly locator: Locator;
      readonly sourceRef: string;
      readonly snippet: string;
    }>;
    readonly method?: unknown;
    readonly model?: unknown;
    readonly promptVersion?: unknown;
  }>;
  readonly sourceSynopsis: Array<{
    readonly text: string;
    readonly kind: string;
    readonly evidenceRefs: Array<{
      readonly excerptId: string;
      readonly locator: Locator;
      readonly localTranscriptRef: string;
      readonly sourceRef?: string;
    }>;
    readonly attribution?: string;
    readonly rationale?: unknown;
    readonly entities?: readonly string[];
  }>;
  readonly resourceId: string;
  readonly dedupAction: 'create' | 'merge' | 'corroborate';
  readonly policyRoute: 'cloud' | 'local' | 'disabled';
  readonly classification: ClassificationResult;
  readonly metadataConflictCount: number;
  readonly references: RunReport['references'];
  readonly warnings: readonly string[];
  readonly segments: Array<{
    readonly id: string;
    readonly locator: Locator;
    readonly text?: string;
    readonly label?: string;
  }>;
  readonly chunks: Array<{
    readonly id: string;
    readonly locator: Locator;
    readonly text: string;
    readonly segmentIds: readonly string[];
  }>;
}

export type SourceId = IngestSummary['sourceId'];

export interface BatchIngestSummary<TSourceId extends SourceId> {
  readonly sourceId: TSourceId;
  readonly itemCount: number;
  readonly outcome: BatchOutcome;
  readonly completed: number;
  readonly failed: number;
  readonly errors: readonly BatchIngestError[];
  readonly summaries: readonly IngestSummary[];
  readonly classification: ClassificationResult;
  readonly metadataConflictCount: number;
  readonly references: RunReport['references'];
  readonly warnings: readonly string[];
}

export interface BatchIngestError {
  readonly item: string;
  readonly message: string;
  readonly timestamp: string;
}

export interface YouTubeBatchSummary extends BatchIngestSummary<'youtube'> {
  readonly playlistId: string;
  readonly videos: number;
}

export type IngestCommandSummary = IngestSummary | ReadwiseBatchSummary | EmailBatchSummary | YouTubeBatchSummary;

export interface IngestExecutionContext {
  readonly services: Partial<PipelineServices>;
  runReport(sourceId: SourceId, ref: string, vector: ComposedVector, metadata?: Record<string, unknown>): Promise<Result<RunReport>>;
  runVector(sourceId: SourceId, ref: string, vector: ComposedVector, metadata?: Record<string, unknown>): Promise<IngestSummary>;
}

export interface SourceIngestManifest<TSummary extends IngestCommandSummary = IngestCommandSummary> {
  readonly sourceId: SourceId;
  readonly registration: SourceRegistration;
  readonly usage: string;
  prepareServices?(args: {
    readonly positionals: readonly string[];
    readonly options: CliOptions;
    readonly services: Partial<PipelineServices>;
  }): Partial<PipelineServices>;
  run(args: {
    readonly positionals: readonly string[];
    readonly options: CliOptions;
    readonly context: IngestExecutionContext;
  }): Promise<TSummary>;
  print(summary: TSummary): readonly string[];
}

function isString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function optionString(options: CliOptions, key: string): string | undefined {
  return isString(options[key]) ? options[key] : undefined;
}

function optionBool(options: CliOptions, key: string): boolean {
  return options[key] === true;
}

type WebFetchFn = NonNullable<Parameters<typeof createWebVectorSpec>[0]>['fetchFn'];

function stableId(seed: string): string {
  return createHash('sha256').update(seed).digest('hex').slice(0, 16);
}

function firstClaimSentence(sourceText: string): string {
  const normalized = sourceText.replace(/\s+/gu, ' ').trim();
  const firstSentence = /[^.!?]+[.!?]/u.exec(normalized)?.[0]?.trim();
  return firstSentence || normalized || 'Fixture evidence is present.';
}

function mockExcerptFromPrompt(user: string): { readonly id: string; readonly text: string } {
  const block = /(?:TRANSCRIPT_EXCERPTS|EXCERPTS):\s*"""([\s\S]*?)"""/u.exec(user)?.[1];
  if (block) {
    try {
      const parsed = JSON.parse(block) as unknown;
      if (Array.isArray(parsed)) {
        const excerpt = parsed.find(item => {
          if (!item || typeof item !== 'object') return false;
          const candidate = item as { id?: unknown; text?: unknown };
          return typeof candidate.id === 'string'
            && typeof candidate.text === 'string'
            && candidate.text.trim().length > 0;
        }) as { id: string; text: string } | undefined;
        if (excerpt) return excerpt;
      }
    } catch {
      // Fall through to conservative regex parsing below.
    }
  }

  const paired = /"id":\s*"([^"]+)"[\s\S]{0,1000}?"text":\s*"((?:[^"\\]|\\.)*)"/u.exec(user);
  return {
    id: paired?.[1] ?? 'mock-excerpt',
    text: paired?.[2]?.replace(/\\n/g, ' ') ?? 'Fixture evidence is present.',
  };
}

function createMockExtractionLlm(): LlmClient {
  return {
    async generate(request) {
      const excerpt = mockExcerptFromPrompt(request.user);
      const claimText = firstClaimSentence(excerpt.text);
      return {
        ok: true,
        value: JSON.stringify({
          claims: [{
            text: claimText,
            excerptIds: [excerpt.id],
            confidence: 0.84,
            type: 'fact',
            classification: 'fact',
            domain: 'CLI Fixture',
            evidenceType: 'direct',
            supportSummary: `The excerpt includes this claim verbatim: "${claimText}"`,
          }],
        }),
      };
    },
  };
}

function parseYouTubeVideoId(input: string): string {
  if (!input.includes('/') && !input.includes('.')) {
    return input;
  }
  try {
    const url = new URL(input);
    if (url.searchParams.has('v')) {
      return url.searchParams.get('v') ?? input;
    }
    if (url.hostname === 'youtu.be') {
      return url.pathname.slice(1);
    }
    if (url.pathname.startsWith('/embed/')) {
      return url.pathname.slice(7);
    }
  } catch {
    return input;
  }
  return input;
}

function parseYouTubePlaylistId(input: string): string {
  if (!input.includes('/') && !input.includes('.')) {
    return input;
  }
  try {
    const url = new URL(input);
    if (url.searchParams.has('list')) {
      return url.searchParams.get('list') ?? input;
    }
  } catch {
    return input;
  }
  return input;
}

function normalizeOutputSegments(segments: readonly MediaSegment[]): IngestSummary['segments'] {
  return segments.map(segment => {
    const entry: {
      id: string;
      locator: Locator;
      text?: string;
      label?: string;
    } = {
      id: segment.id,
      locator: segment.locator,
    };
    if (segment.text !== undefined) {
      entry.text = segment.text;
    }
    if (segment.label !== undefined) {
      entry.label = segment.label;
    }
    return entry;
  });
}

function normalizeOutputChunks(chunks: readonly Chunk[]): IngestSummary['chunks'] {
  return chunks.map(chunk => ({
    id: chunk.id,
    locator: chunk.locator,
    text: chunk.text,
    segmentIds: chunk.segments.map(segment => segment.id),
  }));
}

function aggregateClassification(summaries: readonly { readonly classification: ClassificationResult }[]): ClassificationResult {
  const enabled = summaries.filter(summary => summary.classification.status === 'completed');
  return {
    status: enabled.length > 0 ? 'completed' : 'disabled',
    tagsMatched: summaries.reduce((sum, summary) => sum + summary.classification.tagsMatched, 0),
    tagsAssigned: summaries.reduce((sum, summary) => sum + summary.classification.tagsAssigned, 0),
    warnings: summaries.flatMap(summary => summary.classification.warnings),
  };
}

function aggregateWarnings(summaries: readonly { readonly warnings: readonly string[] }[]): readonly string[] {
  return summaries.flatMap(summary => summary.warnings);
}

function aggregateMetadataConflictCount(summaries: readonly { readonly metadataConflictCount: number }[]): number {
  return summaries.reduce((sum, summary) => sum + summary.metadataConflictCount, 0);
}

function aggregateReferences(summaries: readonly { readonly references: RunReport['references'] }[]): RunReport['references'] {
  return {
    referencesCreated: summaries.reduce((sum, summary) => sum + summary.references.referencesCreated, 0),
    referencesUpdated: summaries.reduce((sum, summary) => sum + summary.references.referencesUpdated, 0),
    referencesNoop: summaries.reduce((sum, summary) => sum + summary.references.referencesNoop, 0),
    referenceEdgesCreated: summaries.reduce((sum, summary) => sum + summary.references.referenceEdgesCreated, 0),
    referenceEdgesUpdated: summaries.reduce((sum, summary) => sum + summary.references.referenceEdgesUpdated, 0),
    referenceEdgesNoop: summaries.reduce((sum, summary) => sum + summary.references.referenceEdgesNoop, 0),
  };
}

function snippetForEvidence(text: unknown, maxLength = 280): string {
  if (typeof text !== 'string') return '';
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 1).trimEnd()}…`;
}

function sourceRefForLocator(sourceId: SourceId, ref: string, locator: Locator): string {
  if (sourceId === 'youtube' && locator.kind === 'timecode') {
    const start = Math.max(0, Math.floor(locator.startSec));
    return `https://www.youtube.com/watch?v=${encodeURIComponent(ref)}&t=${start}s`;
  }
  return `${sourceId}:${ref}`;
}

function isBoxTickingSupport(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  return /^(?:direct|the speaker|the host|the presenter|the demonstrator|the transcript)\b/i.test(value.trim());
}

function summaryFromRunReport(sourceId: SourceId, ref: string, result: RunReport): IngestSummary {
  const chunkById = new Map(result.chunks.map(chunk => [chunk.id, chunk]));
  const claimEvidence = (claim: RunReport['claims'][number]) => claim.excerptIds.flatMap(excerptId => {
    const chunk = chunkById.get(excerptId);
    if (!chunk) return [];
    const sourceRef = sourceRefForLocator(sourceId, ref, chunk.locator);
    return {
      excerptId,
      locator: chunk.locator,
      sourceRef,
      snippet: snippetForEvidence(chunk.text),
    };
  }).filter(evidence => evidence.snippet.length > 0);
  const sourceSynopsis = (result.sourceSynopsis ?? []).map(item => ({
    text: item.text,
    kind: item.kind,
    evidenceRefs: item.evidenceRefs.map(evidenceRef => ({
      excerptId: evidenceRef.excerptId,
      locator: evidenceRef.locator,
      localTranscriptRef: evidenceRef.localTranscriptRef,
      sourceRef: sourceId === 'youtube'
        ? sourceRefForLocator(sourceId, ref, evidenceRef.locator)
        : (evidenceRef.sourceRef ?? sourceRefForLocator(sourceId, evidenceRef.excerptId, evidenceRef.locator)),
    })),
    ...(item.attribution ? { attribution: item.attribution } : {}),
    ...(item.rationale ? { rationale: item.rationale } : {}),
    ...(item.entities ? { entities: item.entities } : {}),
  })).filter(item => item.evidenceRefs.length > 0);
  return {
    sourceId,
    ref,
    canonicalId: result.canonicalId,
    resourceId: result.resourceId,
    segmentCount: result.segmentCount,
    chunkCount: result.chunkCount,
    claimsExtracted: result.claimsExtracted,
    claimIds: result.claimIds,
    claims: result.claims.map(claim => ({
      text: claim.text,
      excerptIds: claim.excerptIds,
      ...(claim.type ? { type: claim.type } : {}),
      ...(claim.classification ? { classification: claim.classification } : {}),
      ...(claim.metadata?.['domain'] ? { domain: claim.metadata['domain'] } : {}),
      ...(claim.confidence !== undefined ? { confidence: claim.confidence } : {}),
      ...(claim.metadata?.['supportSummary'] ? { supportSummary: claim.metadata['supportSummary'] } : {}),
      ...(!claim.metadata?.['supportSummary'] && claim.metadata?.['why'] && !isBoxTickingSupport(claim.metadata['why'])
        ? { supportSummary: claim.metadata['why'] }
        : {}),
      ...(claim.metadata?.['rationale'] ? { rationale: claim.metadata['rationale'] } : {}),
      ...(claim.metadata?.['evidenceType'] ? { evidenceType: claim.metadata['evidenceType'] } : {}),
      ...(claim.metadata?.['qualityStatus'] ? { qualityStatus: claim.metadata['qualityStatus'] } : {}),
      ...(claim.metadata?.['qualityReasons'] ? { qualityReasons: claim.metadata['qualityReasons'] } : {}),
      ...(claim.metadata?.['qualityScore'] !== undefined ? { qualityScore: claim.metadata['qualityScore'] } : {}),
      ...(claim.metadata?.['trusted'] !== undefined ? { trusted: claim.metadata['trusted'] } : {}),
      ...(claim.metadata?.['supportCoverage'] !== undefined ? { supportCoverage: claim.metadata['supportCoverage'] } : {}),
      evidence: claimEvidence(claim),
      method: claim.metadata?.['method'],
      model: claim.metadata?.['model'],
      promptVersion: claim.metadata?.['promptVersion'],
    })),
    sourceSynopsis,
    dedupAction: result.dedupAction,
    policyRoute: result.policyRoute,
    classification: result.classification,
    metadataConflictCount: result.metadataConflictCount,
    references: result.references,
    warnings: result.warnings,
    segments: normalizeOutputSegments(result.segments),
    chunks: normalizeOutputChunks(result.chunks),
  };
}

async function createIngestExecutionContext(services: Partial<PipelineServices> = {}): Promise<{ readonly context: IngestExecutionContext; close(): Promise<void> }> {
  const configured = await createConfiguredPipelineServices(services);
  if (!configured.ok) {
    throw configured.error;
  }
  const runtime = createIngestionRuntimeFromServices(configured.value, {
    store: services.store === undefined,
    taxonomyRegistry: services.taxonomyRegistry === undefined,
  });
  const runReport = async (_sourceId: SourceId, ref: string, vector: ComposedVector, metadata?: Record<string, unknown>): Promise<Result<RunReport>> => {
    const ingestInput = metadata ? { ref, metadata } : { ref };
    return runtime.runVector(vector, ingestInput);
  };
  return {
    context: {
      services: configured.value,
      runReport,
      async runVector(sourceId, ref, vector, metadata) {
        const result = await runReport(sourceId, ref, vector, metadata);
        if (!result.ok) {
          throw result.error;
        }
        return summaryFromRunReport(sourceId, ref, result.value);
      },
    },
    close() {
      return runtime.close();
    },
  };
}

async function buildIngestSummary(
  sourceId: IngestSummary['sourceId'],
  ref: string,
  vector: ComposedVector,
  metadata?: Record<string, unknown>,
  services: Partial<PipelineServices> = {},
): Promise<IngestSummary> {
  const execution = await createIngestExecutionContext(services);
  try {
    return await execution.context.runVector(sourceId, ref, vector, metadata);
  } finally {
    await execution.close();
  }
}

function runSingleVector(
  context: IngestExecutionContext,
  sourceId: SourceId,
  ref: string,
  vector: ComposedVector,
  metadata?: Record<string, unknown>,
): Promise<IngestSummary> {
  return context.runVector(sourceId, ref, vector, metadata);
}

export async function runWebIngest(ref: string, fetchFn?: WebFetchFn, services: Partial<PipelineServices> = {}): Promise<IngestSummary> {
  return buildIngestSummary('web', ref, createWebVectorSpec({ ...(fetchFn ? { fetchFn } : {}) }), undefined, services);
}

export async function runPdfIngest(ref: string, readFileFn?: typeof readFile, services: Partial<PipelineServices> = {}): Promise<IngestSummary> {
  return buildIngestSummary('pdf', ref, createPdfVectorSpec({ ...(readFileFn ? { readFileFn } : {}) }), undefined, services);
}

export async function runVoiceIngest(ref: string, services: Partial<PipelineServices> = {}): Promise<IngestSummary> {
  return buildIngestSummary('voice', ref, createVoiceVectorSpec(), undefined, services);
}

export async function runMeetingIngest(ref: string, services: Partial<PipelineServices> = {}): Promise<IngestSummary> {
  return buildIngestSummary('meeting', ref, createMeetingVectorSpec(), undefined, services);
}

export async function runRssIngest(
  ref: string,
  options: { fetchFn?: WebFetchFn; itemGuid?: string; services?: Partial<PipelineServices> } = {},
): Promise<IngestSummary> {
  const metadata = options.itemGuid ? { itemGuid: options.itemGuid } : undefined;
  return buildIngestSummary('rss', ref, createRssVectorSpec({ ...(options.fetchFn ? { fetchFn: options.fetchFn } : {}) }), metadata, options.services ?? {});
}

export async function runPodcastIngest(
  ref: string,
  options: { fetchFn?: PodcastFetchFn; episodeGuid?: string; panel?: boolean; services?: Partial<PipelineServices> } = {},
): Promise<IngestSummary> {
  const metadata = {
    ...(options.episodeGuid ? { episodeGuid: options.episodeGuid } : {}),
    ...(options.panel ? { panel: true } : {}),
  };
  const vectorOptions = { ...(options.fetchFn ? { fetchFn: options.fetchFn } : {}) };
  return buildIngestSummary('podcast', ref, createPodcastVectorSpec(vectorOptions), metadata, options.services ?? {});
}

export interface ReadwiseBatchSummary extends BatchIngestSummary<'readwise'> {
  readonly updatedAfter?: string;
  readonly totalBooks: number;
}

export async function runReadwiseIngest(
  updatedAfter: string | undefined,
  options: { token: string; fetchFn?: ReadwiseFetchFn; services?: Partial<PipelineServices>; context?: IngestExecutionContext } = { token: '' },
): Promise<ReadwiseBatchSummary> {
  if (!options.token) {
    throw new Error('readwise token is required');
  }

  const readwiseOptions: Parameters<typeof fetchReadwiseExport>[0] = {
    token: options.token,
    ...(options.fetchFn ? { fetchFn: options.fetchFn } : {}),
    ...(updatedAfter ? { updatedAfter } : {}),
  };
  const books = await fetchReadwiseExport(readwiseOptions);

  const runBooks = async (context: IngestExecutionContext) => runBatch({
    items: books,
    clock: context.services.clock ?? { now: () => new Date() },
    async runItem(book: ReadwiseBook) {
      const vector = createReadwiseVectorSpec({ book });
      const ref = book.readwise_url ?? `readwise:book:${book.user_book_id}`;
      const report = await context.runReport('readwise', ref, vector);
      return report.ok
        ? { ok: true as const, value: { ...summaryFromRunReport('readwise', ref, report.value), report: report.value } }
        : report;
    },
  });

  let batch: Awaited<ReturnType<typeof runBooks>>;
  if (options.context) {
    batch = await runBooks(options.context);
  } else {
    const execution = await createIngestExecutionContext(options.services ?? {});
    try {
      batch = await runBooks(execution.context);
    } finally {
      await execution.close();
    }
  }
  const summaries = batch.successes.map(success => success.value);
  const errors = batch.failures.map((failure: { item: ReadwiseBook; message: string; timestamp: string }) => ({
    item: failure.item.readwise_url ?? `readwise:book:${failure.item.user_book_id}`,
    message: failure.message,
    timestamp: failure.timestamp,
  }));

  return {
    sourceId: 'readwise',
    itemCount: books.length,
    outcome: batch.outcome,
    completed: batch.completed,
    failed: batch.failed,
    errors,
    totalBooks: books.length,
    summaries,
    classification: batch.classification,
    metadataConflictCount: batch.metadataConflictCount,
    references: batch.references,
    warnings: [...batch.warnings, ...errors.map(error => `${error.item}: ${error.message}`)],
    ...(updatedAfter ? { updatedAfter } : {}),
  };
}

export async function runEmailIngest(
  ref: string,
  services: Partial<PipelineServices> = {},
  context?: IngestExecutionContext,
): Promise<EmailBatchSummary> {
  if (context?.services.store) {
    return runEmailBatchWithContext(ref, readFile, {
      store: context.services.store,
      ...(context.services.clock ? { clock: context.services.clock } : {}),
      async runVector(vector: ComposedVector, input: { ref: string; metadata?: Record<string, unknown> }) {
        return context.runReport('email', input.ref, vector, input.metadata);
      },
    });
  }
  return runEmailBatch(ref, readFile, services);
}

export async function runLinkedInIngest(
  ref: string,
  options: { pasteText: string; url?: string; services?: Partial<PipelineServices> },
): Promise<IngestSummary> {
  return buildIngestSummary('linkedin', ref, createLinkedInVectorSpec(options), undefined, options.services ?? {});
}

function youtubeConfigFromResolved(config?: ResolvedConfig): ResolvedYoutubeConfig {
  return YouTubeSourceRegistration.validateActiveSourceConfig(config?.activeSourceConfig);
}

export async function runYouTubeIngest(
  ref: string,
  options: { client?: YouTubeClient; services?: Partial<PipelineServices>; context?: IngestExecutionContext; refreshTranscript?: boolean } = {},
): Promise<IngestSummary> {
  const services = options.context?.services ?? options.services ?? {};
  const youtubeConfig = youtubeConfigFromResolved(services.config);
  const transcriptCache = {
    ...youtubeConfig.youtube.transcriptCache,
    ...(typeof options.refreshTranscript === 'boolean' ? { refresh: options.refreshTranscript } : {}),
  };
  const client = options.client ?? new RealYouTubeClient({
    ...youtubeConfig.youtube,
    transcriptCache,
  }, {
    ...youtubeConfig.ytdlp,
    debugTranscript: youtubeConfig.youtube.debugTranscript,
  });
  const vector = createYouTubeVectorSpec({ client });
  if (options.context) {
    return options.context.runVector('youtube', ref, vector);
  }
  return buildIngestSummary('youtube', ref, vector, undefined, services);
}

export async function runYouTubePlaylistIngest(
  playlistRef: string,
  options: { client?: YouTubeClient; services?: Partial<PipelineServices>; context?: IngestExecutionContext; refreshTranscript?: boolean } = {},
): Promise<YouTubeBatchSummary> {
  const services = options.context?.services ?? options.services ?? {};
  const youtubeConfig = youtubeConfigFromResolved(services.config);
  const transcriptCache = {
    ...youtubeConfig.youtube.transcriptCache,
    ...(typeof options.refreshTranscript === 'boolean' ? { refresh: options.refreshTranscript } : {}),
  };
  const client = options.client ?? new RealYouTubeClient({
    ...youtubeConfig.youtube,
    transcriptCache,
  }, {
    ...youtubeConfig.ytdlp,
    debugTranscript: youtubeConfig.youtube.debugTranscript,
  });
  const playlistId = parseYouTubePlaylistId(playlistRef);

  const runPlaylist = async (context: IngestExecutionContext) => runYouTubePlaylistIngestion({
    playlistId,
    client,
    ...(context.services.clock ? { clock: context.services.clock } : {}),
    async runVideo(videoId: string) {
      const report = await context.runReport('youtube', videoId, createYouTubeVectorSpec({ client }));
      if (!report.ok) {
        return report;
      }
      return {
        ok: true,
        value: {
          videoId,
          nodeId: report.value.resourceId,
          classification: report.value.classification,
          created: report.value.dedupAction === 'create',
          report: report.value,
        },
      };
    },
  });

  let summaries: IngestSummary[];
  let result: Awaited<ReturnType<typeof runPlaylist>>;
  if (options.context) {
    result = await runPlaylist(options.context);
  } else {
    const execution = await createIngestExecutionContext(services);
    try {
      result = await runPlaylist(execution.context);
    } finally {
      await execution.close();
    }
  }
  if (!result.ok) {
    throw result.error;
  }
  const playlist = result.value;
  summaries = playlist.videos.map((video: { videoId: string; report: RunReport }) => summaryFromRunReport('youtube', video.videoId, video.report));
  const errors = playlist.job.errors.map((error: { videoId: string; message: string; timestamp: string }) => ({
    item: error.videoId,
    message: error.message,
    timestamp: error.timestamp,
  }));
  const warnings = [
    ...aggregateWarnings(summaries),
    ...errors.map((error: { item: string; message: string }) => `${error.item}: ${error.message}`),
  ];
  return {
    sourceId: 'youtube',
    playlistId,
    videos: summaries.length,
    itemCount: playlist.job.progress.total,
    outcome: playlist.job.status as BatchOutcome,
    completed: playlist.job.progress.completed,
    failed: playlist.job.progress.failed,
    errors,
    summaries,
    classification: playlist.classification,
    metadataConflictCount: aggregateMetadataConflictCount(summaries),
    references: aggregateReferences(summaries),
    warnings,
  };
}

export async function resolveAidhaConfig(
  opts: { configPath?: string; profile?: string; source?: string } = {},
): Promise<{ readonly ok: true; readonly config: ResolvedConfig; readonly loadResult: LoadResult } | { readonly ok: false; readonly error: Error; readonly loadResult: LoadResult }> {
  try {
    const loadOptions: Parameters<typeof loadConfig>[0] = { cwd: process.cwd(), syncProcessEnv: false };
    if (opts.configPath) {
      loadOptions.configPath = opts.configPath;
    }
    const loadResult = await loadConfig(loadOptions);

    const resolveOptions: Parameters<typeof resolveConfig>[0] = {
      rawConfig: loadResult.config,
      baseDir: loadResult.baseDir,
      sourceRegistrations: SOURCE_REGISTRATIONS,
      env: loadResult.dotenvEnv,
      dotenvVarCount: Object.keys(loadResult.dotenvEnv).length,
      warningCount: loadResult.warnings.length,
    };
    if (opts.profile) {
      resolveOptions.profileName = opts.profile;
    }
    if (opts.source) {
      resolveOptions.sourceId = opts.source;
    }
    const config = resolveConfig(resolveOptions);

    return { ok: true, config, loadResult };
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    if (err instanceof ConfigNotFoundError) {
      const resolveOptions: Parameters<typeof resolveConfig>[0] = { sourceRegistrations: SOURCE_REGISTRATIONS };
      if (opts.profile) {
        resolveOptions.profileName = opts.profile;
      }
      if (opts.source) {
        resolveOptions.sourceId = opts.source;
      }
      const config = resolveConfig(resolveOptions);
      return {
        ok: true,
        config,
        loadResult: {
          config: null,
          configPath: opts.configPath ?? null,
          baseDir: process.cwd(),
          warnings: [],
          dotenvEnv: {},
        },
      };
    }
    return {
      ok: false,
      error: err,
      loadResult: {
        config: null,
        configPath: opts.configPath ?? null,
        baseDir: process.cwd(),
        warnings: [],
        dotenvEnv: {},
      },
    };
  }
}

export function explainResolvedKey(
  key: string,
  configResult: { readonly config: ResolvedConfig; readonly loadResult: LoadResult },
  opts: { profile?: string; source?: string } = {},
): string {
  const resolved = configResult.config;
  const provenanceOptions: Parameters<typeof resolveKeyProvenance>[0] = {
    key,
    rawConfig: configResult.loadResult.config,
    resolvedConfig: resolved,
    cliOverrides: {},
    sourceRegistrations: SOURCE_REGISTRATIONS,
  };
  if (opts.profile) {
    provenanceOptions.profileName = opts.profile;
  }
  if (opts.source) {
    provenanceOptions.sourceId = opts.source;
  }
  const { value, provenance } = resolveKeyProvenance(provenanceOptions);
  return formatProvenance(provenance, value);
}

export async function resolveRuntimeServicesForSource(
  sourceId: IngestSummary['sourceId'],
  options: CliOptions,
): Promise<Partial<PipelineServices>> {
  const configOpts: { configPath?: string; profile?: string; source?: string } = { source: sourceId };
  const configPath = optionString(options, 'config');
  const profile = optionString(options, 'profile');
  if (configPath) configOpts.configPath = configPath;
  if (profile) configOpts.profile = profile;
  const configResult = await resolveAidhaConfig(configOpts);
  if (!configResult.ok) {
    throw configResult.error;
  }
  await mkdir(dirname(configResult.config.db), { recursive: true });
  const store = SQLiteStore.open(configResult.config.db);
  return {
    store,
    config: configResult.config,
  };
}

async function closeRuntimeServices(services: Partial<PipelineServices>): Promise<void> {
  await services.store?.close();
}

async function withIngestExecutionContextForManifest<T>(
  manifest: SourceIngestManifest,
  positionals: readonly string[],
  options: CliOptions,
  work: (context: IngestExecutionContext) => Promise<T>,
): Promise<T> {
  const services = await resolveRuntimeServicesForSource(manifest.sourceId, options);
  const mockCacheDir = optionBool(options, 'mock-llm')
    ? await mkdtemp(join(tmpdir(), 'aidha-mock-claims-'))
    : undefined;
  const baseServices = optionBool(options, 'mock-llm')
      ? {
        ...services,
        ...(services.config
          ? { config: { ...services.config, llm: { ...services.config.llm, model: 'mock-acceptance-llm', ...(mockCacheDir ? { cacheDir: mockCacheDir } : {}) } } }
          : {}),
        llm: createMockExtractionLlm(),
      }
    : services;
  const preparedServices = manifest.prepareServices?.({ positionals, options, services: baseServices }) ?? baseServices;
  const execution = await createIngestExecutionContext(preparedServices);
  try {
    return await work(execution.context);
  } finally {
    await execution.close();
    await closeRuntimeServices(services);
  }
}

async function withActivationStore<T>(
  options: CliOptions,
  work: (store: SQLiteStore) => Promise<T>,
): Promise<T> {
  const configOpts: { configPath?: string; profile?: string } = {};
  const configPath = optionString(options, 'config');
  const profile = optionString(options, 'profile');
  if (configPath) configOpts.configPath = configPath;
  if (profile) configOpts.profile = profile;
  const configResult = await resolveAidhaConfig(configOpts);
  if (!configResult.ok) throw configResult.error;
  await mkdir(dirname(configResult.config.db), { recursive: true });
  const store = SQLiteStore.open(configResult.config.db);
  try {
    return await work(store);
  } finally {
    await store.close();
  }
}

function optionNumber(options: CliOptions, key: string): number | undefined {
  const value = optionString(options, key);
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function printClaimHits(hits: Awaited<ReturnType<typeof searchActivationClaims>> extends Result<infer T> ? T : never): void {
  if (hits.length === 0) {
    console.log('No claims found.');
    return;
  }
  for (const hit of hits) {
    const loc = hit.locatorDisplay ? ` [${hit.locatorDisplay.label}]` : '';
    console.log(`${hit.claimId}${loc}: ${hit.claimText}`);
    console.log(`  Source: ${hit.resourceTitle} (${hit.resourceId})`);
  }
}

function printReviewItems(items: Awaited<ReturnType<typeof getActivationReviewQueue>> extends Result<infer T> ? T : never): void {
  if (items.length === 0) {
    console.log('No review items.');
    return;
  }
  for (const item of items) {
    const axes = item.reviewAxes.join('+');
    const priority = item.reviewPriority ? ` priority=${item.reviewPriority.score}` : '';
    console.log(`${item.claimId} [${axes}]${priority}: ${item.claimText}`);
    console.log(`  State: ${item.claimState}; Routing: ${item.routingReviewStatus ?? 'unreviewed'}`);
    console.log(`  Source: ${item.resourceTitle} (${item.resourceId})`);
  }
}

function printSingleIngestSummary(summary: IngestSummary): readonly string[] {
  return [
    `Ingested ${summary.sourceId} ${summary.ref}`,
    `Canonical: ${summary.canonicalId}`,
    `Segments: ${summary.segmentCount}`,
    `Chunks: ${summary.chunkCount}`,
  ];
}

function printBatchTelemetry(summary: {
  readonly outcome: BatchOutcome;
  readonly completed: number;
  readonly failed: number;
  readonly itemCount: number;
  readonly errors: readonly BatchIngestError[];
  readonly warnings: readonly string[];
}): readonly string[] {
  const lines = [
    `Outcome: ${summary.outcome}`,
    `Completed: ${summary.completed}/${summary.itemCount}`,
  ];
  if (summary.failed > 0) {
    lines.push(`Failed: ${summary.failed}`);
    lines.push(...summary.errors.map(error => `Error: ${error.item}: ${error.message}`));
  }
  if (summary.warnings.length > 0) {
    lines.push(...summary.warnings.map(warning => `Warning: ${warning}`));
  }
  return lines;
}

function isYouTubeBatchSummary(summary: IngestCommandSummary): summary is YouTubeBatchSummary {
  return summary.sourceId === 'youtube' && 'playlistId' in summary;
}

function isReadwiseBatchSummary(summary: IngestCommandSummary): summary is ReadwiseBatchSummary {
  return summary.sourceId === 'readwise' && 'totalBooks' in summary;
}

function isEmailBatchSummary(summary: IngestCommandSummary): summary is EmailBatchSummary {
  return summary.sourceId === 'email' && 'threads' in summary;
}

function isSingleIngestSummary(summary: IngestCommandSummary): summary is IngestSummary {
  return 'canonicalId' in summary;
}

function requireRef(options: CliOptions, positionals: readonly string[], key: string, usage: string): string {
  const ref = optionString(options, key) ?? positionals[2];
  if (!ref) {
    throw new Error(`Usage: ${usage}`);
  }
  return ref;
}

function singleVectorManifest(args: {
  readonly sourceId: SourceId;
  readonly registration: SourceRegistration;
  readonly usage: string;
  readonly refOption: string;
  buildVector(): ComposedVector;
  metadata?(options: CliOptions): Record<string, unknown> | undefined;
}): SourceIngestManifest<IngestSummary> {
  return {
    sourceId: args.sourceId,
    registration: args.registration,
    usage: args.usage,
    run: ({ positionals, options, context }) => runSingleVector(
      context,
      args.sourceId,
      requireRef(options, positionals, args.refOption, args.usage),
      args.buildVector(),
      args.metadata?.(options),
    ),
    print: printSingleIngestSummary,
  };
}

const INGEST_USAGE: Record<SourceId, string> = {
  youtube: 'aidha ingest youtube (--url <videoIdOrUrl> | --playlist <playlistIdOrUrl>) [--mock] [--refresh-transcript] [--json]',
  web: 'aidha ingest web --url <url> [--json]',
  pdf: 'aidha ingest pdf --file <path> [--json]',
  voice: 'aidha ingest voice --file <path> [--json]',
  meeting: 'aidha ingest meeting --file <path> [--json]',
  rss: 'aidha ingest rss --feed <url> [--item-guid <guid>] [--json]',
  podcast: 'aidha ingest podcast --feed <url> [--episode <guid>] [--panel] [--json]',
  readwise: 'aidha ingest readwise --since <iso8601> [--token <token>] [--json]',
  email: 'aidha ingest email --file <path> [--json]',
  linkedin: 'aidha ingest linkedin --paste <text> [--url <url>] [--json]',
};

export const SOURCE_MANIFESTS: readonly SourceIngestManifest[] = [
  {
    sourceId: 'youtube',
    registration: YouTubeSourceRegistration,
    usage: INGEST_USAGE.youtube,
    prepareServices({ options, services }) {
      if (!optionBool(options, 'mock')) {
        return services;
      }
      const cacheDir = join(tmpdir(), `aidha-youtube-mock-claims-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`);
      return {
        ...services,
        ...(services.config
          ? {
            config: {
              ...services.config,
              llm: { ...services.config.llm, model: 'mock-youtube-llm', cacheDir },
              editor: { ...services.config.editor, minWords: 1, minChars: 1, minWindows: 1 },
            },
          }
          : {}),
        llm: createMockExtractionLlm(),
      };
    },
    async run({ positionals, options, context }) {
      const mock = optionBool(options, 'mock');
      const client = mock ? new MockYouTubeClient() : undefined;
      const playlist = optionString(options, 'playlist');
      if (playlist) {
        return runYouTubePlaylistIngest(playlist, {
          ...(client ? { client } : {}),
          refreshTranscript: optionBool(options, 'refresh-transcript'),
          context,
        });
      }
      const ref = optionString(options, 'url') ?? positionals[2];
      if (!ref) {
        throw new Error(`Usage: ${INGEST_USAGE.youtube}`);
      }
      return runYouTubeIngest(parseYouTubeVideoId(ref), {
        ...(client ? { client } : {}),
        refreshTranscript: optionBool(options, 'refresh-transcript'),
        context,
      });
    },
    print(summary) {
      if (isYouTubeBatchSummary(summary)) {
        return [
          `Ingested youtube playlist ${summary.playlistId}`,
          `Videos: ${summary.videos}`,
          `Summaries: ${summary.summaries.length}`,
          ...printBatchTelemetry(summary),
        ];
      }
      return isSingleIngestSummary(summary) ? printSingleIngestSummary(summary) : [`Ingested ${summary.sourceId}`];
    },
  },
  singleVectorManifest({
    sourceId: 'web',
    registration: WebSourceRegistration,
    usage: INGEST_USAGE.web,
    refOption: 'url',
    buildVector: () => createWebVectorSpec(),
  }),
  singleVectorManifest({
    sourceId: 'pdf',
    registration: PdfSourceRegistration,
    usage: INGEST_USAGE.pdf,
    refOption: 'file',
    buildVector: () => createPdfVectorSpec(),
  }),
  singleVectorManifest({
    sourceId: 'voice',
    registration: VoiceSourceRegistration,
    usage: INGEST_USAGE.voice,
    refOption: 'file',
    buildVector: () => createVoiceVectorSpec(),
  }),
  singleVectorManifest({
    sourceId: 'meeting',
    registration: MeetingSourceRegistration,
    usage: INGEST_USAGE.meeting,
    refOption: 'file',
    buildVector: () => createMeetingVectorSpec(),
  }),
  singleVectorManifest({
    sourceId: 'rss',
    registration: RssSourceRegistration,
    usage: INGEST_USAGE.rss,
    refOption: 'feed',
    buildVector: () => createRssVectorSpec(),
    metadata: options => optionString(options, 'item-guid') ? { itemGuid: optionString(options, 'item-guid') as string } : undefined,
  }),
  singleVectorManifest({
    sourceId: 'podcast',
    registration: PodcastSourceRegistration,
    usage: INGEST_USAGE.podcast,
    refOption: 'feed',
    buildVector: () => createPodcastVectorSpec(),
    metadata: options => ({
      ...(optionString(options, 'episode') ? { episodeGuid: optionString(options, 'episode') as string } : {}),
      ...(optionBool(options, 'panel') ? { panel: true } : {}),
    }),
  }),
  {
    sourceId: 'readwise',
    registration: ReadwiseSourceRegistration,
    usage: INGEST_USAGE.readwise,
    run: ({ positionals, options, context }) => {
      const since = optionString(options, 'since') ?? positionals[2];
      const token = optionString(options, 'token') ?? process.env['READWISE_TOKEN'];
      if (!token) {
        throw new Error(`Usage: ${INGEST_USAGE.readwise}`);
      }
      return runReadwiseIngest(since, { token, context });
    },
    print(summary) {
      if (!isReadwiseBatchSummary(summary)) return [`Ingested ${summary.sourceId}`];
      return [
        `Ingested readwise export since ${summary.updatedAfter ?? 'start'}`,
        `Books: ${summary.totalBooks}`,
        `Summaries: ${summary.summaries.length}`,
        ...printBatchTelemetry(summary),
      ];
    },
  },
  {
    sourceId: 'email',
    registration: EmailSourceRegistration,
    usage: INGEST_USAGE.email,
    run: ({ positionals, options, context }) => runEmailIngest(requireRef(options, positionals, 'file', INGEST_USAGE.email), context.services, context),
    print(summary) {
      if (!isEmailBatchSummary(summary)) return [`Ingested ${summary.sourceId}`];
      return [
        'Ingested email batch',
        `Threads: ${summary.threads}`,
        `Messages: ${summary.importedFiles}`,
        ...printBatchTelemetry(summary),
      ];
    },
  },
  {
    sourceId: 'linkedin',
    registration: LinkedInSourceRegistration,
    usage: INGEST_USAGE.linkedin,
    async run({ positionals, options, context }) {
      const url = optionString(options, 'url') ?? positionals[2];
      const pasteOption = options['paste'];
      const pasteText = optionString(options, 'paste') ?? (pasteOption === true ? await readStdinText() : undefined);
      if (!pasteText) {
        throw new Error(`Usage: ${INGEST_USAGE.linkedin}`);
      }
      return runSingleVector(
        context,
        'linkedin',
        url ?? 'stdin',
        createLinkedInVectorSpec({ ...(url ? { pasteText, url } : { pasteText }) }),
      );
    },
    print: printSingleIngestSummary,
  },
] as const;

const SOURCE_MANIFEST_BY_ID = new Map(SOURCE_MANIFESTS.map(manifest => [manifest.sourceId, manifest]));
const SOURCE_REGISTRATIONS: SourceRegistration[] = SOURCE_MANIFESTS.map(manifest => manifest.registration);
const CLI_USAGE_TEXT = createCliUsageText(SOURCE_MANIFESTS.map(manifest => manifest.usage));

export async function runCli(argv: string[]): Promise<number> {
  const positionals: string[] = [];
  const options: CliOptions = {};

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg) continue;
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('-')) {
        options[key] = next;
        i += 1;
      } else {
        options[key] = true;
      }
    } else {
      positionals.push(arg);
    }
  }

  const command = positionals[0];
  try {
    if (command === 'config' && positionals[1] === 'explain') {
      const key = positionals[2];
      if (!key) {
        console.error('Usage: config explain <key> [--config <path>] [--profile <name>] [--source <id>]');
        return 1;
      }
      const configOpts: { configPath?: string; profile?: string; source?: string } = {};
      const configPath = optionString(options, 'config');
      const profile = optionString(options, 'profile');
      const source = optionString(options, 'source');
      if (configPath) configOpts.configPath = configPath;
      if (profile) configOpts.profile = profile;
      if (source) configOpts.source = source;
      const configResult = await resolveAidhaConfig(configOpts);
      if (!configResult.ok) {
        console.error(configResult.error.message);
        return 1;
      }
      const explainOpts: { profile?: string; source?: string } = {};
      if (profile) explainOpts.profile = profile;
      if (source) explainOpts.source = source;
      console.log(explainResolvedKey(key, configResult, explainOpts));
      return 0;
    }

    if (command === 'ingest') {
      const mode = positionals[1];
      const manifest = isString(mode) ? SOURCE_MANIFEST_BY_ID.get(mode as SourceId) : undefined;
      if (!manifest) {
        console.error(`Usage: ingest <${SOURCE_MANIFESTS.map(item => item.sourceId).join('|')}> ...`);
        return 1;
      }
      const summary = await withIngestExecutionContextForManifest(manifest, positionals, options, context => manifest.run({
        positionals,
        options,
        context,
      }));
      if (optionBool(options, 'json')) {
        console.log(JSON.stringify(summary, null, 2));
      } else {
        for (const line of manifest.print(summary)) {
          console.log(line);
        }
      }
      return 0;
    }

    if (command === 'query') {
      const query = positionals.slice(1).join(' ').trim();
      if (!query) {
        console.error('Usage: query <text...> [--project <id>] [--source <id>] [--limit <n>] [--include-drafts] [--json]');
        return 1;
      }
      const searchOptions: Parameters<typeof searchActivationClaims>[1] = {
        query,
        states: optionBool(options, 'include-drafts') ? ['accepted', 'draft'] : ['accepted'],
      };
      const queryProject = optionString(options, 'project');
      const querySource = optionString(options, 'source');
      const queryLimit = optionNumber(options, 'limit');
      if (queryProject) searchOptions.projectId = queryProject;
      if (querySource) searchOptions.source = querySource;
      if (queryLimit) searchOptions.limit = queryLimit;
      const result = await withActivationStore(options, store => searchActivationClaims(store, searchOptions));
      if (!result.ok) throw result.error;
      if (optionBool(options, 'json')) console.log(JSON.stringify(result.value, null, 2));
      else printClaimHits(result.value);
      return 0;
    }

    if (command === 'task') {
      const action = positionals[1];
      if (action === 'create') {
        const claimId = optionString(options, 'from-claim');
        const title = optionString(options, 'title');
        if (!claimId || !title) {
          console.error('Usage: task create --from-claim <claimId> --title <title> [--project <id>] [--json]');
          return 1;
        }
        const createInput: Parameters<typeof createActivationTaskFromClaim>[1] = {
          claimId,
          title,
        };
        const createProject = optionString(options, 'project');
        if (createProject) createInput.projectId = createProject;
        const result = await withActivationStore(options, store => createActivationTaskFromClaim(store, createInput));
        if (!result.ok) throw result.error;
        if (optionBool(options, 'json')) console.log(JSON.stringify(result.value, null, 2));
        else {
          console.log(`Created task: ${result.value.taskId}`);
          console.log(`Project: ${result.value.projectId}`);
        }
        return 0;
      }
      if (action === 'show') {
        const taskId = positionals[2];
        if (!taskId) {
          console.error('Usage: task show <taskId> [--json]');
          return 1;
        }
        const result = await withActivationStore(options, store => getActivationTaskContext(store, taskId));
        if (!result.ok) throw result.error;
        if (optionBool(options, 'json')) console.log(JSON.stringify(result.value, null, 2));
        else console.log(formatTaskContext(result.value));
        return 0;
      }
      console.error('Usage: task <create|show> ...');
      return 1;
    }

    if (command === 'review' && positionals[1] === 'next') {
      const reviewOptions: Parameters<typeof getActivationReviewQueue>[1] = {};
      const reviewProject = optionString(options, 'project');
      const reviewSource = optionString(options, 'source');
      const reviewLimit = optionNumber(options, 'limit');
      if (reviewProject) reviewOptions.projectId = reviewProject;
      if (reviewSource) reviewOptions.source = reviewSource;
      if (reviewLimit) reviewOptions.limit = reviewLimit;
      const result = await withActivationStore(options, store => getActivationReviewQueue(store, reviewOptions));
      if (!result.ok) throw result.error;
      if (optionBool(options, 'json')) console.log(JSON.stringify(result.value, null, 2));
      else printReviewItems(result.value);
      return 0;
    }

    if (command === 'trace') {
      const action = positionals[1];
      if (action === 'list') {
        const traceOptions: Parameters<typeof listRationaleTraces>[1] = {
          includeRejected: optionBool(options, 'all'),
        };
        const traceProject = optionString(options, 'project');
        if (traceProject) traceOptions.projectId = traceProject;
        const result = await withActivationStore(options, store => listRationaleTraces(store, traceOptions));
        if (!result.ok) throw result.error;
        if (optionBool(options, 'json')) console.log(JSON.stringify(result.value, null, 2));
        else if (result.value.length === 0) console.log('No traces found.');
        else {
          for (const trace of result.value) {
            console.log(`${trace.id} [${trace.metadata.traceKind}/${trace.metadata.traceReviewStatus}]: ${trace.metadata.rationale}`);
          }
        }
        return 0;
      }
      if (action === 'show') {
        const traceId = positionals[2];
        if (!traceId) {
          console.error('Usage: trace show <traceId> [--json]');
          return 1;
        }
        const result = await withActivationStore(options, store => getRationaleTrace(store, traceId));
        if (!result.ok) throw result.error;
        if (!result.value) {
          console.error(`RationaleTrace not found: ${traceId}`);
          return 1;
        }
        if (optionBool(options, 'json')) console.log(JSON.stringify(result.value, null, 2));
        else {
          console.log(`${result.value.id}: ${result.value.metadata.rationale}`);
          console.log(`Status: ${result.value.metadata.traceReviewStatus}`);
          console.log(`Affected: ${result.value.metadata.affectedNodeIds.join(', ')}`);
        }
        return 0;
      }
      if (action === 'reject') {
        const traceId = positionals[2];
        if (!traceId) {
          console.error('Usage: trace reject <traceId> [--reason <text>] [--json]');
          return 1;
        }
        const reason = optionString(options, 'reason');
        const result = await withActivationStore(options, store => rejectRationaleTrace(store, traceId, reason));
        if (!result.ok) throw result.error;
        if (optionBool(options, 'json')) console.log(JSON.stringify(result.value, null, 2));
        else console.log(`Rejected trace: ${result.value.id}`);
        return 0;
      }
      console.error('Usage: trace <list|show|reject> ...');
      return 1;
    }

    if (command === 'project' && positionals[1] === 'reentry') {
      const projectId = optionString(options, 'project') ?? positionals[2];
      if (!projectId) {
        console.error('Usage: project reentry --project <id> [--json] [--markdown] [--out <path>]');
        return 1;
      }
      const result = await withActivationStore(options, store => buildProjectReentryDossier(store, projectId));
      if (!result.ok) throw result.error;
      if (optionBool(options, 'json')) {
        console.log(JSON.stringify(result.value, null, 2));
      } else if (optionBool(options, 'markdown') || optionString(options, 'out')) {
        const markdown = renderProjectReentryMarkdown(result.value);
        const out = optionString(options, 'out');
        if (out) {
          await mkdir(dirname(out), { recursive: true });
          await writeFile(out, markdown, 'utf-8');
          console.log(`Wrote re-entry dossier: ${out}`);
        } else {
          console.log(markdown);
        }
      } else {
        console.log(`Project: ${result.value.project.label} (${result.value.project.id})`);
        console.log('Next actions:');
        for (const action of result.value.suggestedNextActions) console.log(`- ${action}`);
        console.log(`Tasks: ${result.value.tasks.length}`);
        console.log(`Claims: ${result.value.claims.length}`);
        console.log(`Review items: ${result.value.reviewItems.length}`);
      }
      return 0;
    }

    if (command === 'export') {
      const mode = positionals[1];
      if (mode !== 'graph' || !optionBool(options, 'jsonld')) {
        console.error('Usage: export graph --jsonld [--out <path>]');
        return 1;
      }
      const result = await withActivationStore(options, async store => {
        const snapshot = await store.exportSnapshot({ scope: 'full' });
        if (!snapshot.ok) return snapshot;
        return {
          ok: true,
          value: serializeJsonLd(toJsonLd(snapshot.value.nodes, snapshot.value.edges)),
        } as const;
      });
      if (!result.ok) throw result.error;
      const out = optionString(options, 'out');
      if (out) {
        await mkdir(dirname(out), { recursive: true });
        await writeFile(out, `${result.value}\n`, 'utf-8');
        console.log(`Wrote JSON-LD graph export: ${out}`);
      } else {
        console.log(result.value);
      }
      return 0;
    }

    console.log(CLI_USAGE_TEXT);
    return 0;
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    console.error(err.message);
    return 1;
  }
}

export function makeStableLabel(seed: string): string {
  return stableId(seed);
}

function readStdinText(): Promise<string> {
  if (process.stdin.isTTY) {
    return Promise.resolve('');
  }
  return new Promise<string>((resolve, reject) => {
    const chunks: string[] = [];
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', chunk => {
      chunks.push(String(chunk));
    });
    process.stdin.on('end', () => {
      resolve(chunks.join(''));
    });
    process.stdin.on('error', reject);
  });
}
