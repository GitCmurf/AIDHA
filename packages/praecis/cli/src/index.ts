import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import {
  formatProvenance,
  loadConfig,
  resolveConfig,
  resolveKeyProvenance,
  ConfigNotFoundError,
} from '@aidha/config';
import type { LoadResult, ResolvedConfig, SourceRegistration } from '@aidha/config';
import { YouTubeSourceRegistration } from '@aidha/ingestion-youtube';
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
import { composeVector, type ComposedVector } from '@aidha/praecis-core';
import type { Chunk, Locator, MediaSegment } from '@aidha/praecis-core';

import { CLI_USAGE_TEXT } from './help.js';

export interface CliOptions {
  [key: string]: string | boolean | undefined;
}

export interface IngestSummary {
  readonly sourceId: 'web' | 'pdf' | 'voice' | 'meeting' | 'rss' | 'podcast';
  readonly ref: string;
  readonly canonicalId: string;
  readonly label?: string;
  readonly segmentCount: number;
  readonly chunkCount: number;
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

const SOURCE_REGISTRATIONS: SourceRegistration[] = [
  YouTubeSourceRegistration,
  WebSourceRegistration,
  PdfSourceRegistration,
  VoiceSourceRegistration,
  MeetingSourceRegistration,
  RssSourceRegistration,
  PodcastSourceRegistration,
];

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
): Promise<IngestSummary> {
  const ingestInput = metadata ? { ref, metadata } : { ref };
  const result = await vector.ingestAndDecode(ingestInput);
  if (!result.ok) {
    throw result.error;
  }

  const context = await vector.context.build(result.value.raw, {} as ResolvedConfig);
  const chunkResult = await vector.chunking.chunk({ segments: result.value.segments, context });
  if (!chunkResult.ok) {
    throw chunkResult.error;
  }

  return {
    sourceId,
    ref,
    canonicalId: result.value.raw.canonicalId,
    label: result.value.raw.label,
    segmentCount: result.value.segments.length,
    chunkCount: chunkResult.value.length,
    warnings: result.value.warnings.map(w => `${w.unit}: ${w.reason}`),
    segments: normalizeOutputSegments(result.value.segments),
    chunks: normalizeOutputChunks(chunkResult.value),
  };
}

export async function runWebIngest(ref: string, fetchFn?: WebFetchFn): Promise<IngestSummary> {
  return buildIngestSummary('web', ref, composeVector(createWebVectorSpec(fetchFn)));
}

export async function runPdfIngest(ref: string, readFileFn?: typeof readFile): Promise<IngestSummary> {
  return buildIngestSummary('pdf', ref, composeVector(createPdfVectorSpec(readFileFn)));
}

export async function runVoiceIngest(ref: string): Promise<IngestSummary> {
  return buildIngestSummary('voice', ref, createVoiceVectorSpec());
}

export async function runMeetingIngest(ref: string): Promise<IngestSummary> {
  return buildIngestSummary('meeting', ref, createMeetingVectorSpec());
}

export async function runRssIngest(
  ref: string,
  options: { fetchFn?: WebFetchFn; itemGuid?: string } = {},
): Promise<IngestSummary> {
  const metadata = options.itemGuid ? { itemGuid: options.itemGuid } : undefined;
  return buildIngestSummary('rss', ref, composeVector(createRssVectorSpec(options.fetchFn)), metadata);
}

export async function runPodcastIngest(
  ref: string,
  options: { fetchFn?: PodcastFetchFn; episodeGuid?: string; panel?: boolean } = {},
): Promise<IngestSummary> {
  const metadata = {
    ...(options.episodeGuid ? { episodeGuid: options.episodeGuid } : {}),
    ...(options.panel ? { panel: true } : {}),
  };
  const vectorOptions = options.fetchFn ? { fetchFn: options.fetchFn } : {};
  return buildIngestSummary('podcast', ref, createPodcastVectorSpec(vectorOptions), metadata);
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
      if (mode === 'web') {
        const ref = optionString(options, 'url') ?? positionals[2];
        if (!ref) {
          console.error('Usage: ingest web --url <url> [--json]');
          return 1;
        }
        const summary = await runWebIngest(ref);
        if (optionBool(options, 'json')) {
          console.log(JSON.stringify(summary, null, 2));
        } else {
          console.log(`Ingested web ${summary.ref}`);
          console.log(`Canonical: ${summary.canonicalId}`);
          console.log(`Segments: ${summary.segmentCount}`);
          console.log(`Chunks: ${summary.chunkCount}`);
        }
        return 0;
      }

      if (mode === 'pdf') {
        const ref = optionString(options, 'file') ?? positionals[2];
        if (!ref) {
          console.error('Usage: ingest pdf --file <path> [--json]');
          return 1;
        }
        const summary = await runPdfIngest(ref);
        if (optionBool(options, 'json')) {
          console.log(JSON.stringify(summary, null, 2));
        } else {
          console.log(`Ingested pdf ${summary.ref}`);
          console.log(`Canonical: ${summary.canonicalId}`);
          console.log(`Segments: ${summary.segmentCount}`);
          console.log(`Chunks: ${summary.chunkCount}`);
        }
        return 0;
      }

      if (mode === 'voice') {
        const ref = optionString(options, 'file') ?? positionals[2];
        if (!ref) {
          console.error('Usage: ingest voice --file <path> [--json]');
          return 1;
        }
        const summary = await runVoiceIngest(ref);
        if (optionBool(options, 'json')) {
          console.log(JSON.stringify(summary, null, 2));
        } else {
          console.log(`Ingested voice ${summary.ref}`);
          console.log(`Canonical: ${summary.canonicalId}`);
          console.log(`Segments: ${summary.segmentCount}`);
          console.log(`Chunks: ${summary.chunkCount}`);
        }
        return 0;
      }

      if (mode === 'meeting') {
        const ref = optionString(options, 'file') ?? positionals[2];
        if (!ref) {
          console.error('Usage: ingest meeting --file <path> [--json]');
          return 1;
        }
        const summary = await runMeetingIngest(ref);
        if (optionBool(options, 'json')) {
          console.log(JSON.stringify(summary, null, 2));
        } else {
          console.log(`Ingested meeting ${summary.ref}`);
          console.log(`Canonical: ${summary.canonicalId}`);
          console.log(`Segments: ${summary.segmentCount}`);
          console.log(`Chunks: ${summary.chunkCount}`);
        }
        return 0;
      }

      if (mode === 'rss') {
        const ref = optionString(options, 'feed') ?? positionals[2];
        if (!ref) {
          console.error('Usage: ingest rss --feed <url> [--item-guid <guid>] [--json]');
          return 1;
        }
        const summary = await runRssIngest(ref, {
          ...(optionString(options, 'item-guid') ? { itemGuid: optionString(options, 'item-guid') as string } : {}),
        });
        if (optionBool(options, 'json')) {
          console.log(JSON.stringify(summary, null, 2));
        } else {
          console.log(`Ingested rss ${summary.ref}`);
          console.log(`Canonical: ${summary.canonicalId}`);
          console.log(`Segments: ${summary.segmentCount}`);
          console.log(`Chunks: ${summary.chunkCount}`);
        }
        return 0;
      }

      if (mode === 'podcast') {
        const ref = optionString(options, 'feed') ?? positionals[2];
        if (!ref) {
          console.error('Usage: ingest podcast --feed <url> [--episode <guid>] [--panel] [--json]');
          return 1;
        }
        const summary = await runPodcastIngest(ref, {
          ...(optionString(options, 'episode') ? { episodeGuid: optionString(options, 'episode') as string } : {}),
          ...(optionBool(options, 'panel') ? { panel: true } : {}),
        });
        if (optionBool(options, 'json')) {
          console.log(JSON.stringify(summary, null, 2));
        } else {
          console.log(`Ingested podcast ${summary.ref}`);
          console.log(`Canonical: ${summary.canonicalId}`);
          console.log(`Segments: ${summary.segmentCount}`);
          console.log(`Chunks: ${summary.chunkCount}`);
        }
        return 0;
      }

      console.error('Usage: ingest <web|pdf|voice|meeting|rss|podcast> ...');
      return 1;
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
