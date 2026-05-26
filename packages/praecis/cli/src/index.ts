import { createHash } from 'node:crypto';
import { mkdir, readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { SQLiteStore } from '@aidha/graph-backend';
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
import { composeVector, createConfiguredPipelineServices, createIngestionRuntimeFromServices, runBatch, type BatchOutcome, type ClassificationResult, type ComposedVector, type LlmClient, type PipelineServices, type Result, type RunReport } from '@aidha/praecis-core';
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
    readonly method?: unknown;
    readonly model?: unknown;
    readonly promptVersion?: unknown;
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

type WebFetchFn = Parameters<typeof createWebVectorSpec>[0];

function stableId(seed: string): string {
  return createHash('sha256').update(seed).digest('hex').slice(0, 16);
}

function createMockExtractionLlm(): LlmClient {
  return {
    async generate(request) {
      const excerptId = /"id":\s*"([^"]+)"/.exec(request.user)?.[1] ?? 'mock-excerpt';
      return {
        ok: true,
        value: JSON.stringify({
          claims: [{
            text: 'The mock YouTube fixture contains a claim-worthy point for review.',
            excerptIds: [excerptId],
            confidence: 0.84,
            type: 'fact',
            classification: 'fact',
            evidenceType: 'direct',
            why: 'Deterministic mock extraction keeps generic CLI tests offline.',
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

function summaryFromRunReport(sourceId: SourceId, ref: string, result: RunReport): IngestSummary {
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
      method: claim.metadata?.['method'],
      model: claim.metadata?.['model'],
      promptVersion: claim.metadata?.['promptVersion'],
    })),
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

export async function runWebIngest(ref: string, fetchFn?: WebFetchFn, services: Partial<PipelineServices> = {}): Promise<IngestSummary> {
  return buildIngestSummary('web', ref, composeVector(createWebVectorSpec(fetchFn, services.clock)), undefined, services);
}

export async function runPdfIngest(ref: string, readFileFn?: typeof readFile, services: Partial<PipelineServices> = {}): Promise<IngestSummary> {
  return buildIngestSummary('pdf', ref, composeVector(createPdfVectorSpec(readFileFn, services.clock)), undefined, services);
}

export async function runVoiceIngest(ref: string, services: Partial<PipelineServices> = {}): Promise<IngestSummary> {
  return buildIngestSummary('voice', ref, createVoiceVectorSpec({ ...(services.clock ? { clock: services.clock } : {}) }), undefined, services);
}

export async function runMeetingIngest(ref: string, services: Partial<PipelineServices> = {}): Promise<IngestSummary> {
  return buildIngestSummary('meeting', ref, createMeetingVectorSpec({ ...(services.clock ? { clock: services.clock } : {}) }), undefined, services);
}

export async function runRssIngest(
  ref: string,
  options: { fetchFn?: WebFetchFn; itemGuid?: string; services?: Partial<PipelineServices> } = {},
): Promise<IngestSummary> {
  const metadata = options.itemGuid ? { itemGuid: options.itemGuid } : undefined;
  return buildIngestSummary('rss', ref, composeVector(createRssVectorSpec(options.fetchFn, options.services?.clock)), metadata, options.services ?? {});
}

export async function runPodcastIngest(
  ref: string,
  options: { fetchFn?: PodcastFetchFn; episodeGuid?: string; panel?: boolean; services?: Partial<PipelineServices> } = {},
): Promise<IngestSummary> {
  const metadata = {
    ...(options.episodeGuid ? { episodeGuid: options.episodeGuid } : {}),
    ...(options.panel ? { panel: true } : {}),
  };
  const vectorOptions = { ...(options.fetchFn ? { fetchFn: options.fetchFn } : {}), ...(options.services?.clock ? { clock: options.services.clock } : {}) };
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
    async runItem(book) {
      const vector = createReadwiseVectorSpec(book, context.services.clock);
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
  const errors = batch.failures.map(failure => ({
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
      async runVector(vector, input) {
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
  return buildIngestSummary('linkedin', ref, createLinkedInVectorSpec({ ...options, ...(options.services?.clock ? { clock: options.services.clock } : {}) }), undefined, options.services ?? {});
}

function youtubeConfigFromResolved(config?: ResolvedConfig): ResolvedYoutubeConfig {
  return YouTubeSourceRegistration.validateActiveSourceConfig(config?.activeSourceConfig);
}

export async function runYouTubeIngest(
  ref: string,
  options: { client?: YouTubeClient; services?: Partial<PipelineServices>; context?: IngestExecutionContext } = {},
): Promise<IngestSummary> {
  const services = options.context?.services ?? options.services ?? {};
  const youtubeConfig = youtubeConfigFromResolved(services.config);
  const client = options.client ?? new RealYouTubeClient(youtubeConfig.youtube, {
    ...youtubeConfig.ytdlp,
    debugTranscript: youtubeConfig.youtube.debugTranscript,
  });
  const vector = composeVector(createYouTubeVectorSpec(client, services.clock));
  if (options.context) {
    return options.context.runVector('youtube', ref, vector);
  }
  return buildIngestSummary('youtube', ref, vector, undefined, services);
}

export async function runYouTubePlaylistIngest(
  playlistRef: string,
  options: { client?: YouTubeClient; services?: Partial<PipelineServices>; context?: IngestExecutionContext } = {},
): Promise<YouTubeBatchSummary> {
  const services = options.context?.services ?? options.services ?? {};
  const youtubeConfig = youtubeConfigFromResolved(services.config);
  const client = options.client ?? new RealYouTubeClient(youtubeConfig.youtube, {
    ...youtubeConfig.ytdlp,
    debugTranscript: youtubeConfig.youtube.debugTranscript,
  });
  const playlistId = parseYouTubePlaylistId(playlistRef);

  const runPlaylist = async (context: IngestExecutionContext) => runYouTubePlaylistIngestion({
    playlistId,
    client,
    ...(context.services.clock ? { clock: context.services.clock } : {}),
    async runVideo(videoId) {
      const report = await context.runReport('youtube', videoId, composeVector(createYouTubeVectorSpec(client, context.services.clock)));
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
  summaries = playlist.videos.map(video => summaryFromRunReport('youtube', video.videoId, video.report));
  const errors = playlist.job.errors.map(error => ({
    item: error.videoId,
    message: error.message,
    timestamp: error.timestamp,
  }));
  const warnings = [
    ...aggregateWarnings(summaries),
    ...errors.map(error => `${error.item}: ${error.message}`),
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
  const preparedServices = manifest.prepareServices?.({ positionals, options, services }) ?? services;
  const execution = await createIngestExecutionContext(preparedServices);
  try {
    return await work(execution.context);
  } finally {
    await execution.close();
    await closeRuntimeServices(services);
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

const INGEST_USAGE: Record<SourceId, string> = {
  youtube: 'aidha ingest youtube (--url <videoIdOrUrl> | --playlist <playlistIdOrUrl>) [--mock] [--json]',
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
      return {
        ...services,
        ...(services.config && !services.config.llm.model
          ? { config: { ...services.config, llm: { ...services.config.llm, model: 'mock-youtube-llm' } } }
          : {}),
        llm: createMockExtractionLlm(),
      };
    },
    async run({ positionals, options, context }) {
      const mock = optionBool(options, 'mock');
      const client = mock ? new MockYouTubeClient() : undefined;
      const playlist = optionString(options, 'playlist');
      if (playlist) {
        return runYouTubePlaylistIngest(playlist, { ...(client ? { client } : {}), context });
      }
      const ref = optionString(options, 'url') ?? positionals[2];
      if (!ref) {
        throw new Error(`Usage: ${INGEST_USAGE.youtube}`);
      }
      return runYouTubeIngest(parseYouTubeVideoId(ref), { ...(client ? { client } : {}), context });
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
  {
    sourceId: 'web',
    registration: WebSourceRegistration,
    usage: INGEST_USAGE.web,
    run: ({ positionals, options, context }) => context.runVector('web', requireRef(options, positionals, 'url', INGEST_USAGE.web), composeVector(createWebVectorSpec(undefined, context.services.clock))),
    print: printSingleIngestSummary,
  },
  {
    sourceId: 'pdf',
    registration: PdfSourceRegistration,
    usage: INGEST_USAGE.pdf,
    run: ({ positionals, options, context }) => context.runVector('pdf', requireRef(options, positionals, 'file', INGEST_USAGE.pdf), composeVector(createPdfVectorSpec(undefined, context.services.clock))),
    print: printSingleIngestSummary,
  },
  {
    sourceId: 'voice',
    registration: VoiceSourceRegistration,
    usage: INGEST_USAGE.voice,
    run: ({ positionals, options, context }) => context.runVector('voice', requireRef(options, positionals, 'file', INGEST_USAGE.voice), createVoiceVectorSpec({ ...(context.services.clock ? { clock: context.services.clock } : {}) })),
    print: printSingleIngestSummary,
  },
  {
    sourceId: 'meeting',
    registration: MeetingSourceRegistration,
    usage: INGEST_USAGE.meeting,
    run: ({ positionals, options, context }) => context.runVector('meeting', requireRef(options, positionals, 'file', INGEST_USAGE.meeting), createMeetingVectorSpec({ ...(context.services.clock ? { clock: context.services.clock } : {}) })),
    print: printSingleIngestSummary,
  },
  {
    sourceId: 'rss',
    registration: RssSourceRegistration,
    usage: INGEST_USAGE.rss,
    run: ({ positionals, options, context }) => context.runVector(
      'rss',
      requireRef(options, positionals, 'feed', INGEST_USAGE.rss),
      composeVector(createRssVectorSpec(undefined, context.services.clock)),
      optionString(options, 'item-guid') ? { itemGuid: optionString(options, 'item-guid') as string } : undefined,
    ),
    print: printSingleIngestSummary,
  },
  {
    sourceId: 'podcast',
    registration: PodcastSourceRegistration,
    usage: INGEST_USAGE.podcast,
    run: ({ positionals, options, context }) => context.runVector(
      'podcast',
      requireRef(options, positionals, 'feed', INGEST_USAGE.podcast),
      createPodcastVectorSpec({ ...(context.services.clock ? { clock: context.services.clock } : {}) }),
      {
        ...(optionString(options, 'episode') ? { episodeGuid: optionString(options, 'episode') as string } : {}),
        ...(optionBool(options, 'panel') ? { panel: true } : {}),
      },
    ),
    print: printSingleIngestSummary,
  },
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
      const linkedInOptions = { ...(url ? { pasteText, url } : { pasteText }), ...(context.services.clock ? { clock: context.services.clock } : {}) };
      return context.runVector('linkedin', url ?? 'stdin', createLinkedInVectorSpec(linkedInOptions));
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

async function readStdinText(): Promise<string> {
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
