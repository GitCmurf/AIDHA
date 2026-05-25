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
  EmailSourceRegistration,
  type EmailBatchSummary,
} from '@aidha/praecis-source-email';
import {
  createLinkedInVectorSpec,
  LinkedInSourceRegistration,
} from '@aidha/praecis-source-linkedin';
import { composeVector, createIngestionRuntime, type ClassificationResult, type ComposedVector, type LlmClient, type PipelineServices } from '@aidha/praecis-core';
import type { Chunk, Locator, MediaSegment } from '@aidha/praecis-core';

import { CLI_USAGE_TEXT, INGEST_USAGE_LINES } from './help.js';

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

type SourceId = IngestSummary['sourceId'];

export interface YouTubeBatchSummary {
  readonly sourceId: 'youtube';
  readonly playlistId: string;
  readonly videos: number;
  readonly summaries: readonly IngestSummary[];
}

type IngestCommandSummary = IngestSummary | ReadwiseBatchSummary | EmailBatchSummary | YouTubeBatchSummary;

interface SourceIngestManifest<TSummary extends IngestCommandSummary = IngestCommandSummary> {
  readonly sourceId: SourceId;
  readonly registration: SourceRegistration;
  readonly usage: string;
  run(args: {
    readonly positionals: readonly string[];
    readonly options: CliOptions;
    readonly services: Partial<PipelineServices>;
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

async function buildIngestSummary(
  sourceId: IngestSummary['sourceId'],
  ref: string,
  vector: ComposedVector,
  metadata?: Record<string, unknown>,
  services: Partial<PipelineServices> = {},
): Promise<IngestSummary> {
  const ingestInput = metadata ? { ref, metadata } : { ref };
  const runtime = await createIngestionRuntime(services);
  if (!runtime.ok) {
    throw runtime.error;
  }
  try {
    const result = await runtime.value.runVector(vector, ingestInput);
    if (!result.ok) {
      throw result.error;
    }

    return {
      sourceId,
      ref,
      canonicalId: result.value.canonicalId,
      resourceId: result.value.resourceId,
      segmentCount: result.value.segmentCount,
      chunkCount: result.value.chunkCount,
      claimsExtracted: result.value.claimsExtracted,
      claimIds: result.value.claimIds,
      claims: result.value.claims.map(claim => ({
        text: claim.text,
        excerptIds: claim.excerptIds,
        method: claim.metadata?.['method'],
        model: claim.metadata?.['model'],
        promptVersion: claim.metadata?.['promptVersion'],
      })),
      dedupAction: result.value.dedupAction,
      policyRoute: result.value.policyRoute,
      classification: result.value.classification,
      metadataConflictCount: result.value.metadataConflictCount,
      warnings: result.value.warnings,
      segments: normalizeOutputSegments(result.value.segments),
      chunks: normalizeOutputChunks(result.value.chunks),
    };
  } finally {
    await runtime.value.close();
  }
}

export async function runWebIngest(ref: string, fetchFn?: WebFetchFn, services: Partial<PipelineServices> = {}): Promise<IngestSummary> {
  return buildIngestSummary('web', ref, composeVector(createWebVectorSpec(fetchFn)), undefined, services);
}

export async function runPdfIngest(ref: string, readFileFn?: typeof readFile, services: Partial<PipelineServices> = {}): Promise<IngestSummary> {
  return buildIngestSummary('pdf', ref, composeVector(createPdfVectorSpec(readFileFn)), undefined, services);
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
  return buildIngestSummary('rss', ref, composeVector(createRssVectorSpec(options.fetchFn)), metadata, options.services ?? {});
}

export async function runPodcastIngest(
  ref: string,
  options: { fetchFn?: PodcastFetchFn; episodeGuid?: string; panel?: boolean; services?: Partial<PipelineServices> } = {},
): Promise<IngestSummary> {
  const metadata = {
    ...(options.episodeGuid ? { episodeGuid: options.episodeGuid } : {}),
    ...(options.panel ? { panel: true } : {}),
  };
  const vectorOptions = options.fetchFn ? { fetchFn: options.fetchFn } : {};
  return buildIngestSummary('podcast', ref, createPodcastVectorSpec(vectorOptions), metadata, options.services ?? {});
}

export interface ReadwiseBatchSummary {
  readonly sourceId: 'readwise';
  readonly updatedAfter?: string;
  readonly totalBooks: number;
  readonly summaries: readonly IngestSummary[];
}

export async function runReadwiseIngest(
  updatedAfter: string | undefined,
  options: { token: string; fetchFn?: ReadwiseFetchFn; services?: Partial<PipelineServices> } = { token: '' },
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

  const summaries: IngestSummary[] = [];
  for (const book of books) {
    const vector = createReadwiseVectorSpec(book);
    const ref = book.readwise_url ?? `readwise:book:${book.user_book_id}`;
    const summary = await buildIngestSummary('readwise', ref, vector, undefined, options.services ?? {});
    summaries.push(summary);
  }

  return {
    sourceId: 'readwise',
    totalBooks: books.length,
    summaries,
    ...(updatedAfter ? { updatedAfter } : {}),
  };
}

export async function runEmailIngest(ref: string, services: Partial<PipelineServices> = {}): Promise<EmailBatchSummary> {
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
  options: { client?: YouTubeClient; services?: Partial<PipelineServices> } = {},
): Promise<IngestSummary> {
  const youtubeConfig = youtubeConfigFromResolved(options.services?.config);
  const client = options.client ?? new RealYouTubeClient(youtubeConfig.youtube, {
    ...youtubeConfig.ytdlp,
    debugTranscript: youtubeConfig.youtube.debugTranscript,
  });
  return buildIngestSummary('youtube', ref, composeVector(createYouTubeVectorSpec(client)), undefined, options.services ?? {});
}

export async function runYouTubePlaylistIngest(
  playlistRef: string,
  options: { client?: YouTubeClient; services?: Partial<PipelineServices> } = {},
): Promise<YouTubeBatchSummary> {
  const youtubeConfig = youtubeConfigFromResolved(options.services?.config);
  const client = options.client ?? new RealYouTubeClient(youtubeConfig.youtube, {
    ...youtubeConfig.ytdlp,
    debugTranscript: youtubeConfig.youtube.debugTranscript,
  });
  const playlistId = parseYouTubePlaylistId(playlistRef);
  const videos = await client.fetchPlaylist(playlistId);
  if (!videos.ok) {
    throw videos.error;
  }
  const summaries: IngestSummary[] = [];
  for (const videoId of videos.value.videoIds) {
    summaries.push(await buildIngestSummary(
      'youtube',
      videoId,
      composeVector(createYouTubeVectorSpec(client)),
      undefined,
      options.services ?? {},
    ));
  }
  return {
    sourceId: 'youtube',
    playlistId,
    videos: summaries.length,
    summaries,
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

async function withRuntimeServicesForSource<T>(
  sourceId: IngestSummary['sourceId'],
  options: CliOptions,
  work: (services: Partial<PipelineServices>) => Promise<T>,
): Promise<T> {
  const services = await resolveRuntimeServicesForSource(sourceId, options);
  try {
    return await work(services);
  } finally {
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

const SOURCE_MANIFESTS: readonly SourceIngestManifest[] = [
  {
    sourceId: 'youtube',
    registration: YouTubeSourceRegistration,
    usage: INGEST_USAGE_LINES[0],
    async run({ positionals, options, services }) {
      const mock = optionBool(options, 'mock');
      const youtubeServices: Partial<PipelineServices> = mock
        ? {
            ...services,
            ...(services.config && !services.config.llm.model
              ? { config: { ...services.config, llm: { ...services.config.llm, model: 'mock-youtube-llm' } } }
              : {}),
            llm: createMockExtractionLlm(),
          }
        : services;
      const client = mock ? new MockYouTubeClient() : undefined;
      const playlist = optionString(options, 'playlist');
      if (playlist) {
        return runYouTubePlaylistIngest(playlist, { ...(client ? { client } : {}), services: youtubeServices });
      }
      const ref = optionString(options, 'url') ?? positionals[2];
      if (!ref) {
        throw new Error(`Usage: ${INGEST_USAGE_LINES[0]}`);
      }
      return runYouTubeIngest(parseYouTubeVideoId(ref), { ...(client ? { client } : {}), services: youtubeServices });
    },
    print(summary) {
      if (isYouTubeBatchSummary(summary)) {
        return [
          `Ingested youtube playlist ${summary.playlistId}`,
          `Videos: ${summary.videos}`,
          `Summaries: ${summary.summaries.length}`,
        ];
      }
      return isSingleIngestSummary(summary) ? printSingleIngestSummary(summary) : [`Ingested ${summary.sourceId}`];
    },
  },
  {
    sourceId: 'web',
    registration: WebSourceRegistration,
    usage: INGEST_USAGE_LINES[1],
    run: ({ positionals, options, services }) => runWebIngest(requireRef(options, positionals, 'url', INGEST_USAGE_LINES[1]), undefined, services),
    print: printSingleIngestSummary,
  },
  {
    sourceId: 'pdf',
    registration: PdfSourceRegistration,
    usage: INGEST_USAGE_LINES[2],
    run: ({ positionals, options, services }) => runPdfIngest(requireRef(options, positionals, 'file', INGEST_USAGE_LINES[2]), undefined, services),
    print: printSingleIngestSummary,
  },
  {
    sourceId: 'voice',
    registration: VoiceSourceRegistration,
    usage: INGEST_USAGE_LINES[3],
    run: ({ positionals, options, services }) => runVoiceIngest(requireRef(options, positionals, 'file', INGEST_USAGE_LINES[3]), services),
    print: printSingleIngestSummary,
  },
  {
    sourceId: 'meeting',
    registration: MeetingSourceRegistration,
    usage: INGEST_USAGE_LINES[4],
    run: ({ positionals, options, services }) => runMeetingIngest(requireRef(options, positionals, 'file', INGEST_USAGE_LINES[4]), services),
    print: printSingleIngestSummary,
  },
  {
    sourceId: 'rss',
    registration: RssSourceRegistration,
    usage: INGEST_USAGE_LINES[5],
    run: ({ positionals, options, services }) => runRssIngest(requireRef(options, positionals, 'feed', INGEST_USAGE_LINES[5]), {
      ...(optionString(options, 'item-guid') ? { itemGuid: optionString(options, 'item-guid') as string } : {}),
      services,
    }),
    print: printSingleIngestSummary,
  },
  {
    sourceId: 'podcast',
    registration: PodcastSourceRegistration,
    usage: INGEST_USAGE_LINES[6],
    run: ({ positionals, options, services }) => runPodcastIngest(requireRef(options, positionals, 'feed', INGEST_USAGE_LINES[6]), {
      ...(optionString(options, 'episode') ? { episodeGuid: optionString(options, 'episode') as string } : {}),
      ...(optionBool(options, 'panel') ? { panel: true } : {}),
      services,
    }),
    print: printSingleIngestSummary,
  },
  {
    sourceId: 'readwise',
    registration: ReadwiseSourceRegistration,
    usage: INGEST_USAGE_LINES[7],
    run: ({ positionals, options, services }) => {
      const since = optionString(options, 'since') ?? positionals[2];
      const token = optionString(options, 'token') ?? process.env['READWISE_TOKEN'];
      if (!token) {
        throw new Error(`Usage: ${INGEST_USAGE_LINES[7]}`);
      }
      return runReadwiseIngest(since, { token, services });
    },
    print(summary) {
      if (!isReadwiseBatchSummary(summary)) return [`Ingested ${summary.sourceId}`];
      return [
        `Ingested readwise export since ${summary.updatedAfter ?? 'start'}`,
        `Books: ${summary.totalBooks}`,
        `Summaries: ${summary.summaries.length}`,
      ];
    },
  },
  {
    sourceId: 'email',
    registration: EmailSourceRegistration,
    usage: INGEST_USAGE_LINES[8],
    run: ({ positionals, options, services }) => runEmailIngest(requireRef(options, positionals, 'file', INGEST_USAGE_LINES[8]), services),
    print(summary) {
      if (!isEmailBatchSummary(summary)) return [`Ingested ${summary.sourceId}`];
      return [
        'Ingested email batch',
        `Threads: ${summary.threads}`,
        `Messages: ${summary.importedFiles}`,
      ];
    },
  },
  {
    sourceId: 'linkedin',
    registration: LinkedInSourceRegistration,
    usage: INGEST_USAGE_LINES[9],
    async run({ positionals, options, services }) {
      const url = optionString(options, 'url') ?? positionals[2];
      const pasteOption = options['paste'];
      const pasteText = optionString(options, 'paste') ?? (pasteOption === true ? await readStdinText() : undefined);
      if (!pasteText) {
        throw new Error(`Usage: ${INGEST_USAGE_LINES[9]}`);
      }
      const linkedInOptions = url ? { pasteText, url, services } : { pasteText, services };
      return runLinkedInIngest(url ?? 'stdin', linkedInOptions);
    },
    print: printSingleIngestSummary,
  },
] as const;

const SOURCE_MANIFEST_BY_ID = new Map(SOURCE_MANIFESTS.map(manifest => [manifest.sourceId, manifest]));
const SOURCE_REGISTRATIONS: SourceRegistration[] = SOURCE_MANIFESTS.map(manifest => manifest.registration);

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
      const summary = await withRuntimeServicesForSource(manifest.sourceId, options, services => manifest.run({
        positionals,
        options,
        services,
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
