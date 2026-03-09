#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runEvalMatrix } from './cli-eval.js';
import { InMemoryRegistry } from '@aidha/taxonomy';
import { SQLiteStore } from '@aidha/graph-backend';
import {
  MockYouTubeClient,
  RealYouTubeClient,
  IngestionPipeline,
  ClaimExtractionPipeline,
  LlmClaimExtractor,
  ReferenceExtractionPipeline,
  purgeClaimsForVideo,
  DossierExporter,
  searchClaims,
  findRelatedClaims,
  createTaskFromClaim,
  createTaskStandalone,
  getTaskContext,
  formatTaskContext,
  createArea,
  createGoal,
  createProject,
  normalizeProjectIdForCli,
  getReviewQueue,
  applyReviewAction,
  diagnoseTranscript,
  diagnoseExtraction,
  formatTranscriptDiagnosis,
  formatExtractionDiagnosis,
} from './index.js';
import { runConfig } from './cli/config-cmd.js';
import { parseArgs } from './cli/parse.js';
import { CLI_USAGE_TEXT } from './cli/help.js';
import { formatIngestionStatus } from './cli/status.js';
import type { ClaimState } from './utils/claim-state.js';
import type { Result } from './pipeline/types.js';
import { runYtDlpPreflight } from './client/yt-dlp.js';
import { parseTranscriptTtml } from './client/transcript.js';
import {
  resolveCliConfig,
  buildCliOverrides,
} from './cli/config-bridge.js';
import type { ResolvedConfig } from '@aidha/config';
import { createLlmClientFromConfig } from './extract/llm-client.js';

export type CliOptions = Record<string, string | boolean>;

// CLI constants
const ENV_VERBOSE = 'AIDHA_VERBOSE';
const ERROR_PREFIX = '[error]';
const VERBOSE = process.env[ENV_VERBOSE] === '1' || process.env[ENV_VERBOSE] === 'true';

export function sanitizeErrorMessage(message: string): string {
  return message
    .replace(/(["'])(authorization)\1\s*[:=]\s*(["'])(Bearer\s+)?([^"']+)\3/gi, '$1$2$1: [REDACTED]')
    .replace(/(["'])(api[_-]?key|token|secret)\1\s*[:=]\s*(["'])([^"']+)\3/gi, '$1$2$1: [REDACTED]')
    .replace(/(["']?)(authorization)\1\s*[:=]\s*(Bearer\s+)?([^\r\n,}\]]+)/gi, '$1$2$1: [REDACTED]')
    .replace(/(["']?)(api[_-]?key|token|secret)\1\s*[:=]\s*([^\s,"'}\]]+)/gi, '$2=[REDACTED]')
    .replace(/Bearer\s+[A-Za-z0-9._-]+/g, 'Bearer [REDACTED]')
    .replace(/sk-[a-zA-Z0-9]{5,}/g, 'sk-[REDACTED]');
}

function parseVideoId(input: string): string {
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

function parsePlaylistId(input: string): string {
  try {
    const url = new URL(input);
    const list = url.searchParams.get('list');
    return list ?? input;
  } catch {
    return input;
  }
}

export function resolveSourceId(positionals: string[], options: CliOptions): string | undefined {
  const explicit = options['source'];
  if (typeof explicit === 'string' && explicit.trim().length > 0) {
    return explicit.trim();
  }

  const command = positionals[0];
  if (
    command === 'ingest' ||
    command === 'extract' ||
    command === 'claims' ||
    command === 'export' ||
    command === 'query' ||
    command === 'related' ||
    command === 'review' ||
    command === 'task' ||
    command === 'area' ||
    command === 'goal' ||
    command === 'project' ||
    command === 'diagnose' ||
    command === 'preflight' ||
    command === 'fixtures' ||
    command === 'eval'
    // command === 'config' // Removed in Phase 2A Round 3 fix
  ) {
    return 'youtube';
  }

  return undefined;
}

function normalizeEntrypointPath(pathValue: string): string {
  const absolute = resolve(pathValue);
  try {
    return realpathSync(absolute);
  } catch {
    return absolute;
  }
}

export function isCliEntrypoint(importMetaUrl: string, argv1?: string): boolean {
  if (!argv1) return false;
  return normalizeEntrypointPath(fileURLToPath(importMetaUrl)) === normalizeEntrypointPath(argv1);
}

export function optionString(options: CliOptions, key: string, fallback: string): string {
  const value = options[key];
  return typeof value === 'string' && value.length > 0 ? value : fallback;
}

export function optionNumber(options: CliOptions, key: string, fallback: number): number {
  const value = options[key];
  if (typeof value === 'string') {
    const parsed = Number.parseInt(value, 10);
    return Number.isNaN(parsed) ? fallback : parsed;
  }
  return fallback;
}

export function optionBool(options: CliOptions, key: string): boolean {
  return options[key] === true;
}

function resolveSourcePrefix(options: CliOptions, fallback: string): string {
  const raw = options['source-prefix'];
  if (typeof raw === 'string') {
    const value = raw.trim().toLowerCase();
    if (value.length > 0) return value;
  }
  return fallback;
}

function parseClaimStates(options: CliOptions): ClaimState[] {
  const statesOption = options['states'];
  const includeDrafts = optionBool(options, 'include-drafts');
  const includeRejected = optionBool(options, 'include-rejected');
  const allowed = new Set<ClaimState>();

  if (typeof statesOption === 'string' && statesOption.trim().length > 0) {
    const parts = statesOption.split(',').map(part => part.trim().toLowerCase());
    for (const part of parts) {
      if (part === 'draft' || part === 'accepted' || part === 'rejected') {
        allowed.add(part);
      }
    }
  } else {
    allowed.add('accepted');
    if (includeDrafts) allowed.add('draft');
    if (includeRejected) allowed.add('rejected');
  }

  if (allowed.size === 0) {
    allowed.add('accepted');
    if (includeDrafts) allowed.add('draft');
    if (includeRejected) allowed.add('rejected');
  }

  return Array.from(allowed.values());
}

function parseCsvList(options: CliOptions, key: string): string[] {
  const value = options[key];
  if (typeof value !== 'string' || value.trim().length === 0) return [];
  return value.split(',').map(item => item.trim()).filter(Boolean);
}

async function ensureDir(path: string): Promise<void> {
  await mkdir(path, { recursive: true });
}

function csvEscape(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function deriveDraftPath(path: string): string {
  if (path.endsWith('.draft.md')) return path;
  if (path.endsWith('.md')) return path.slice(0, -3) + '.draft.md';
  return `${path}.draft.md`;
}

function printHelp(): void {
  console.log(CLI_USAGE_TEXT);
}

async function openStore(options: CliOptions, config: ResolvedConfig): Promise<SQLiteStore> {
  const dbPath = config.db;
  await ensureDir(dirname(dbPath));
  return SQLiteStore.open(dbPath);
}

async function runIngest(positionals: string[], options: CliOptions, config: ResolvedConfig): Promise<number> {
  const mode = positionals[1];
  const target = positionals[2];
  if (!mode || !target) {
    console.error('Usage: ingest <playlist|video> <idOrUrl>');
    return 1;
  }

  // Note: config.ytdlp has already incorporated CLI overrides via buildCliOverrides()

  const store = await openStore(options, config);
  const taxonomyRegistry = new InMemoryRegistry();

  // Resolve full YtDlpRuntimeConfig
  const ytDlpConfig = {
    ...config.ytdlp,
    debugTranscript: config.youtube.debugTranscript,
  };

  const client = optionBool(options, 'mock')
    ? new MockYouTubeClient()
    : new RealYouTubeClient(config.youtube, ytDlpConfig);

  const pipeline = new IngestionPipeline({
    graphStore: store,
    taxonomyRegistry,
    youtubeClient: client,
  });

  if (mode === 'playlist') {
    const playlistId = parsePlaylistId(target);
    const result = await pipeline.ingestPlaylist(playlistId);
    if (!result.ok) {
      console.error(result.error.message);
      await store.close();
      await taxonomyRegistry.close();
      return 1;
    }
    console.log(`Ingested playlist ${playlistId}: ${result.value.videosProcessed} videos`);
    if (result.value.job.errors.length > 0) {
      console.log(`Errors: ${result.value.job.errors.length}`);
    }
  } else if (mode === 'status') {
    const videoId = parseVideoId(target);
    const { getIngestionStatus } = await import('./pipeline/status.js');
    const statusResult = await getIngestionStatus(store, videoId);
    if (!statusResult.ok) {
      console.error(statusResult.error.message);
      await store.close();
      await taxonomyRegistry.close();
      return 1;
    }
    const output = formatIngestionStatus(statusResult.value, {
      json: optionBool(options, 'json'),
    });
    console.log(output);
  } else if (mode === 'video') {
    const videoId = parseVideoId(target);
    const result = await pipeline.ingestVideo(videoId);
    if (!result.ok) {
      console.error(result.error.message);
      await store.close();
      await taxonomyRegistry.close();
      return 1;
    }
    console.log(`Ingested video ${videoId}`);
    const nodeResult = await store.getNode(`youtube-${videoId}`);
    if (nodeResult.ok && nodeResult.value) {
      const status = nodeResult.value.metadata?.['transcriptStatus'];
      if (status === 'missing') {
        const error = nodeResult.value.metadata?.['transcriptError'];
        console.log(`Transcript unavailable (${error ?? 'unknown reason'}).`);
      }
    }
  } else {
    console.error('Unknown ingest mode. Use playlist or video.');
    await store.close();
    await taxonomyRegistry.close();
    return 1;
  }

  await store.close();
  await taxonomyRegistry.close();
  return 0;
}

async function runExtract(positionals: string[], options: CliOptions, config: ResolvedConfig): Promise<number> {
  const mode = positionals[1];
  const videoArg = positionals[2];
  if (!mode || !videoArg) {
    console.error('Usage: extract <claims|refs> <videoIdOrUrl>');
    return 1;
  }
  const videoId = parseVideoId(videoArg);
  const store = await openStore(options, config);

  if (mode === 'claims') {
    const useLlm = optionBool(options, 'llm');
    const editorLlm = optionBool(options, 'editor-llm');
    const showEditorDiagnostics = optionBool(options, 'editorial-diagnostics');

    let extractor: LlmClaimExtractor | undefined;
    if (useLlm) {
      if (!config.llm.model) {
        console.error('Missing LLM model. Provide --model or set llm.model in config.');
        await store.close();
        return 1;
      }

      const clientResult = createLlmClientFromConfig(config.llm);
      if (!clientResult.ok) {
        console.error(clientResult.error.message);
        await store.close();
        return 1;
      }

      extractor = new LlmClaimExtractor({
        client: clientResult.value,
        model: config.llm.model,
        promptVersion: config.extraction.promptVersion,
        chunkMinutes: config.extraction.chunkMinutes > 0 ? config.extraction.chunkMinutes : undefined,
        maxChunks: config.extraction.maxChunks > 0 ? config.extraction.maxChunks : undefined,
        cacheDir: config.llm.cacheDir || undefined,
        editorVersion: config.editor.version === 'v2' ? 'v2' : 'v1',
        editorWindowMinutes: config.editor.windowMinutes > 0 ? config.editor.windowMinutes : undefined,
        editorMaxPerWindow: config.editor.maxPerWindow > 0 ? config.editor.maxPerWindow : undefined,
        editorMinWindows: config.editor.minWindows > 0 ? config.editor.minWindows : undefined,
        editorMinWords: config.editor.minWords > 0 ? config.editor.minWords : undefined,
        editorMinChars: config.editor.minChars > 0 ? config.editor.minChars : undefined,
        editorLlm: config.editor.editorLlm || editorLlm,
        reasoningEffort: config.llm.reasoningEffort,
        verbosity: config.llm.verbosity,
      });
    }

    const pipeline = new ClaimExtractionPipeline({ graphStore: store, extractor });
    const result = await pipeline.extractClaimsForVideo(videoId, {
      maxClaims: config.extraction.maxClaims > 0 ? config.extraction.maxClaims : undefined,
    });
    if (!result.ok) {
      console.error(result.error.message);
      await store.close();
      return 1;
    }
    console.log(`Claims: created=${result.value.claimsCreated} updated=${result.value.claimsUpdated} noop=${result.value.claimsNoop}`);

    if (showEditorDiagnostics) {
      const resourceId = `youtube-${videoId}`;
      const resourceResult = await store.getNode(resourceId);
      if (resourceResult.ok && resourceResult.value) {
        const diagnosticsJson = resourceResult.value.metadata?.['lastClaimRunEditorDiagnostics'];
        if (typeof diagnosticsJson === 'string') {
          try {
            const diagnostics = JSON.parse(diagnosticsJson) as import('./extract/editorial-ranking.js').EditorialDiagnostics;
            console.log('\nEditorial Diagnostics:');
            console.log(`  Total candidates: ${diagnostics.totalCandidates}`);
            console.log(`  Selected: ${diagnostics.selectedCount}`);
            console.log(`  Dropped: ${Object.entries(diagnostics.droppedCounts).map(([reason, count]) => `${reason}=${count}`).join(', ')}`);
            console.log('  Window coverage:');
            for (const coverage of diagnostics.windowCoverage) {
              console.log(`    Window ${coverage.windowIndex}: ${coverage.selectedCount} claims`);
            }
            if (diagnostics.echoAnalyzedCount > 0) {
              console.log(`  Echo detection: analyzed=${diagnostics.echoAnalyzedCount} tagged=${diagnostics.echoTaggedCount}`);
            }
          } catch {
            console.log('  (Unable to parse diagnostics)');
          }
        } else {
          console.log('  (No diagnostics available)');
        }
      }
    }
  } else if (mode === 'refs') {
    const pipeline = new ReferenceExtractionPipeline({ graphStore: store });
    const result = await pipeline.extractReferencesForVideo(videoId);
    if (!result.ok) {
      console.error(result.error.message);
      await store.close();
      return 1;
    }
    console.log(
      `References: created=${result.value.referencesCreated} updated=${result.value.referencesUpdated} noop=${result.value.referencesNoop}`
    );
  } else {
    console.error('Unknown extract mode. Use claims or refs.');
    await store.close();
    return 1;
  }

  await store.close();
  return 0;
}

async function runClaims(positionals: string[], options: CliOptions, config: ResolvedConfig): Promise<number> {
  const action = positionals[1];
  const target = positionals[2];
  if (action !== 'purge' || !target) {
    console.error('Usage: claims purge <videoIdOrUrl>');
    return 1;
  }

  const videoId = parseVideoId(target);
  const store = await openStore(options, config);
  const result = await purgeClaimsForVideo(store, videoId);
  if (!result.ok) {
    console.error(result.error.message);
    await store.close();
    return 1;
  }

  console.log(
    `Claims purged for ${videoId}: deleted=${result.value.deletedClaims} metadataCleared=${result.value.clearedRunMetadata ? 'yes' : 'no'}`
  );
  await store.close();
  return 0;
}

async function runExport(positionals: string[], options: CliOptions, config: ResolvedConfig): Promise<number> {
  const kind = positionals[1];
  if (!kind) {
    console.error('Usage: export <dossier|transcript|gephi> ...');
    return 1;
  }

  if (kind === 'gephi') {
    const store = await openStore(options, config);
    const predicateOpt = optionString(options, 'predicate', '');
    const nodeTypeOpt = optionString(options, 'node-type', '');
    const includeLabels = optionBool(options, 'include-labels');
    const outDir = optionString(options, 'out', config.export.outDir || './out');

    const predicates = predicateOpt
      ? predicateOpt.split(',').map(s => s.trim()).filter(Boolean) as import('@aidha/graph-backend').ExportGephiOptions['predicates']
      : undefined;
    const nodeTypes = nodeTypeOpt
      ? nodeTypeOpt.split(',').map(s => s.trim()).filter(Boolean) as import('@aidha/graph-backend').ExportGephiOptions['nodeTypes']
      : undefined;

    const result = await store.exportGephi({ predicates, nodeTypes, includeLabels });
    if (!result.ok) {
      console.error(result.error.message);
      await store.close();
      return 1;
    }

    await ensureDir(outDir);
    const nodeHeader = includeLabels ? 'Id,Label,Type,CreatedAt' : 'Id,Type,CreatedAt';
    const nodeRows = result.value.nodes.map(n =>
      includeLabels
        ? `${csvEscape(n.id)},${csvEscape(n.label ?? '')},${csvEscape(n.type)},${csvEscape(n.createdAt)}`
        : `${csvEscape(n.id)},${csvEscape(n.type)},${csvEscape(n.createdAt)}`
    );
    const nodesPath = resolve(outDir, 'nodes.csv');
    await writeFile(nodesPath, [nodeHeader, ...nodeRows].join('\n') + '\n', 'utf-8');

    const edgeHeader = 'Source,Target,Type,Weight,CreatedAt';
    const edgeRows = result.value.edges.map(e =>
      `${csvEscape(e.source)},${csvEscape(e.target)},${csvEscape(e.predicate)},${e.weight},${csvEscape(e.createdAt)}`
    );
    const edgesPath = resolve(outDir, 'edges.csv');
    await writeFile(edgesPath, [edgeHeader, ...edgeRows].join('\n') + '\n', 'utf-8');

    console.log(`Wrote ${result.value.nodes.length} nodes: ${nodesPath}`);
    console.log(`Wrote ${result.value.edges.length} edges: ${edgesPath}`);
    await store.close();
    return 0;
  }

  const entity = positionals[2];
  const target = positionals[3];
  if (!entity || !target) {
    console.error('Usage: export <dossier|transcript> <video|playlist> <idOrUrl>');
    return 1;
  }

  const store = await openStore(options, config);
  const exporter = new DossierExporter({ graphStore: store });
  const splitStates = optionBool(options, 'split-states');
  const states = parseClaimStates(options);
  const pretty = optionBool(options, 'pretty');
  const sourcePrefix = resolveSourcePrefix(options, config.export.sourcePrefix);

  const resolvePlaylistInput = async (): Promise<Result<{
    playlistId: string;
    url: string;
    videoIds: string[];
  }>> => {
    const playlistId = parsePlaylistId(target);
    let videoIds: string[] = [];
    const videosOption = options['videos'];
    if (typeof videosOption === 'string' && videosOption.length > 0) {
      videoIds = videosOption.split(',').map(v => v.trim()).filter(Boolean);
    } else {
      const client = optionBool(options, 'mock')
        ? new MockYouTubeClient()
        : new RealYouTubeClient(config.youtube, {
            ...config.ytdlp,
            debugTranscript: config.youtube.debugTranscript,
          });
      const playlistResult = await client.fetchPlaylist(playlistId);
      if (!playlistResult.ok) return playlistResult;
      videoIds = playlistResult.value.videoIds;
    }
    return {
      ok: true,
      value: {
        playlistId,
        url: `https://www.youtube.com/playlist?list=${playlistId}`,
        videoIds,
      },
    };
  };

  if (kind === 'dossier' && entity === 'video') {
    const videoId = parseVideoId(target);
    const result = await exporter.renderVideoDossier(videoId, { states });
    if (!result.ok) {
      console.error(result.error.message);
      await store.close();
      return 1;
    }
    const outPath = optionString(options, 'out', `${config.export.outDir}/dossier-${sourcePrefix}-${videoId}.md`);
    await ensureDir(dirname(outPath));
    await writeFile(outPath, result.value, 'utf-8');
    console.log(`Wrote dossier: ${resolve(outPath)}`);
    if (splitStates) {
      const draftResult = await exporter.renderVideoDossier(videoId, { states: ['accepted', 'draft'] });
      if (!draftResult.ok) {
        console.error(draftResult.error.message);
        await store.close();
        return 1;
      }
      const draftPath = deriveDraftPath(outPath);
      await writeFile(draftPath, draftResult.value, 'utf-8');
      console.log(`Wrote draft dossier: ${resolve(draftPath)}`);
    }
  } else if (kind === 'dossier' && entity === 'playlist') {
    const playlistInput = await resolvePlaylistInput();
    if (!playlistInput.ok) {
      console.error(playlistInput.error.message);
      await store.close();
      return 1;
    }
    const result = await exporter.renderPlaylistDossier(
      {
        playlistId: playlistInput.value.playlistId,
        title: undefined,
        url: playlistInput.value.url,
        videoIds: playlistInput.value.videoIds,
      },
      { states }
    );
    if (!result.ok) {
      console.error(result.error.message);
      await store.close();
      return 1;
    }
    const outPath = optionString(
      options,
      'out',
      `${config.export.outDir}/dossier-${sourcePrefix}-playlist-${playlistInput.value.playlistId}.md`
    );
    await ensureDir(dirname(outPath));
    await writeFile(outPath, result.value, 'utf-8');
    console.log(`Wrote dossier: ${resolve(outPath)}`);
    if (splitStates) {
      const draftResult = await exporter.renderPlaylistDossier(
        {
          playlistId: playlistInput.value.playlistId,
          title: undefined,
          url: playlistInput.value.url,
          videoIds: playlistInput.value.videoIds,
        },
        { states: ['accepted', 'draft'] }
      );
      if (!draftResult.ok) {
        console.error(draftResult.error.message);
        await store.close();
        return 1;
      }
      const draftPath = deriveDraftPath(outPath);
      await writeFile(draftPath, draftResult.value, 'utf-8');
      console.log(`Wrote draft dossier: ${resolve(draftPath)}`);
    }
  } else if (kind === 'transcript' && entity === 'video') {
    const videoId = parseVideoId(target);
    const result = await exporter.exportTranscriptJson(videoId, { pretty });
    if (!result.ok) {
      console.error(result.error.message);
      await store.close();
      return 1;
    }
    const outPath = optionString(options, 'out', `${config.export.outDir}/transcript-${sourcePrefix}-${videoId}.json`);
    await ensureDir(dirname(outPath));
    await writeFile(outPath, result.value, 'utf-8');
    console.log(`Wrote transcript: ${resolve(outPath)}`);
  } else if (kind === 'transcript' && entity === 'playlist') {
    const playlistInput = await resolvePlaylistInput();
    if (!playlistInput.ok) {
      console.error(playlistInput.error.message);
      await store.close();
      return 1;
    }
    const result = await exporter.exportPlaylistTranscriptJson(
      {
        playlistId: playlistInput.value.playlistId,
        title: undefined,
        url: playlistInput.value.url,
        videoIds: playlistInput.value.videoIds,
      },
      { pretty }
    );
    if (!result.ok) {
      console.error(result.error.message);
      await store.close();
      return 1;
    }
    const outPath = optionString(
      options,
      'out',
      `${config.export.outDir}/transcript-${sourcePrefix}-playlist-${playlistInput.value.playlistId}.json`
    );
    await ensureDir(dirname(outPath));
    await writeFile(outPath, result.value, 'utf-8');
    console.log(`Wrote transcript: ${resolve(outPath)}`);
  } else {
    console.error('Unknown export target. Use dossier/transcript with video/playlist.');
    await store.close();
    return 1;
  }

  await store.close();
  return 0;
}

async function runQuery(positionals: string[], options: CliOptions, config: ResolvedConfig): Promise<number> {
  const queryText = positionals.slice(1).join(' ').trim();
  if (!queryText) {
    console.error('Usage: query <text>');
    return 1;
  }
  const store = await openStore(options, config);
  const limit = optionNumber(options, 'limit', 10);
  const project = optionString(options, 'project', '');
  const area = optionString(options, 'area', '');
  const goal = optionString(options, 'goal', '');
  const states = parseClaimStates(options);
  const result = await searchClaims(store, {
    query: queryText,
    limit,
    projectId: project ? normalizeProjectIdForCli(project) : undefined,
    areaId: area || undefined,
    goalId: goal || undefined,
    states,
  });
  if (!result.ok) {
    console.error(result.error.message);
    await store.close();
    return 1;
  }

  if (result.value.length === 0) {
    console.log('No matches found.');
  } else {
    for (const hit of result.value) {
      console.log(`- [${hit.timestampLabel}] ${hit.claimText}`);
      console.log(`  ${hit.timestampUrl}`);
      if (hit.excerptText) {
        console.log(`  Excerpt: ${hit.excerptText}`);
      }
      console.log(`  Source: ${hit.resourceTitle}`);
    }
  }
  await store.close();
  return 0;
}

async function runRelated(positionals: string[], options: CliOptions, config: ResolvedConfig): Promise<number> {
  const claimId = optionString(options, 'claim', '');
  if (!claimId) {
    console.error('Usage: related --claim <claimId>');
    return 1;
  }
  const store = await openStore(options, config);
  const limit = optionNumber(options, 'limit', 10);
  const includeDrafts = optionBool(options, 'include-drafts');
  const result = await findRelatedClaims(store, {
    claimId,
    limit,
    includeDrafts,
  });
  if (!result.ok) {
    console.error(result.error.message);
    await store.close();
    return 1;
  }
  if (result.value.length === 0) {
    console.log('No related claims found.');
  } else {
    for (const hit of result.value) {
      console.log(`- [${hit.timestampLabel}] ${hit.claimText}`);
      if (hit.timestampUrl) console.log(`  ${hit.timestampUrl}`);
      console.log(
        `  score=${hit.score.toFixed(2)} refs=${hit.sharedReferenceCount} tags=${hit.sharedTagCount} token=${hit.tokenSimilarity.toFixed(2)}`
      );
      console.log(`  Source: ${hit.resourceTitle}`);
    }
  }
  await store.close();
  return 0;
}

async function runReview(positionals: string[], options: CliOptions, config: ResolvedConfig): Promise<number> {
  const action = positionals[1];
  if (!action) {
    console.error('Usage: review <next|apply> ...');
    return 1;
  }
  const store = await openStore(options, config);

  if (action === 'next') {
    const target = positionals[2];
    const state = optionString(options, 'state', 'draft').toLowerCase();
    const states: ClaimState[] = [];
    if (state === 'all') {
      states.push('draft', 'accepted', 'rejected');
    } else if (state === 'accepted' || state === 'draft' || state === 'rejected') {
      states.push(state);
    } else {
      states.push('draft');
    }
    const limit = optionNumber(options, 'limit', 10);
    const result = await getReviewQueue(store, {
      videoId: target ? parseVideoId(target) : undefined,
      limit,
      states,
    });
    if (!result.ok) {
      console.error(result.error.message);
      await store.close();
      return 1;
    }
    if (optionBool(options, 'json')) {
      console.log(JSON.stringify(result.value, null, 2));
    } else if (result.value.length === 0) {
      console.log('Review queue is empty for the selected scope.');
    } else {
      for (const item of result.value) {
        console.log(`- ${item.claimId} [${item.claimState}] [${item.timestampLabel}] ${item.claimText}`);
        if (item.timestampUrl) console.log(`  ${item.timestampUrl}`);
        if (item.excerptText) console.log(`  Excerpt: ${item.excerptText}`);
        console.log(`  Source: ${item.resourceTitle}`);
      }
    }
  } else if (action === 'apply') {
    const claimIds = parseCsvList(options, 'claims');
    if (claimIds.length === 0) {
      console.error('Missing --claims <id1,id2>.');
      await store.close();
      return 1;
    }
    const explicitState = optionString(options, 'state', '').toLowerCase();
    let state: ClaimState | undefined;
    if (optionBool(options, 'accept')) state = 'accepted';
    else if (optionBool(options, 'reject')) state = 'rejected';
    else if (optionBool(options, 'draft')) state = 'draft';
    else if (explicitState === 'accepted' || explicitState === 'draft' || explicitState === 'rejected') {
      state = explicitState;
    }
    const text = optionString(options, 'text', '');
    const tags = parseTags(options);
    const taskTitle = optionString(options, 'task-title', '');
    const project = optionString(options, 'project', '');

    const result = await applyReviewAction(store, {
      claimIds,
      state,
      text: text || undefined,
      tags,
      createTask: taskTitle
        ? {
            title: taskTitle,
            projectId: project || undefined,
          }
        : undefined,
    });
    if (!result.ok) {
      console.error(result.error.message);
      await store.close();
      return 1;
    }
    console.log(
      `Review applied: claims=${result.value.updatedClaims} tags=${result.value.updatedTags} tasks=${result.value.createdTasks}`
    );
  } else {
    console.error('Unknown review action. Use next or apply.');
    await store.close();
    return 1;
  }

  await store.close();
  return 0;
}

async function runDiagnose(positionals: string[], options: CliOptions, config: ResolvedConfig): Promise<number> {
  const mode = positionals[1];
  if (!mode) {
    console.error('Usage: diagnose <transcript|extract|editor|stats> ...');
    return 1;
  }

  if (mode === 'stats') {
    const store = await openStore(options, config);
    const topN = optionNumber(options, 'top', 10);
    const result = await store.getGraphStats({ topN });
    if (!result.ok) {
      console.error(result.error.message);
      await store.close();
      return 1;
    }
    if (optionBool(options, 'json')) {
      console.log(JSON.stringify(result.value, null, 2));
    } else {
      const stats = result.value;
      console.log('=== Node Counts ===');
      for (const [type, count] of Object.entries(stats.nodeCounts).sort()) {
        console.log(`  ${type}: ${count}`);
      }
      console.log('\n=== Edge Counts ===');
      for (const [pred, count] of Object.entries(stats.edgeCounts).sort()) {
        console.log(`  ${pred}: ${count}`);
      }
      if (stats.claimStateCounts && Object.keys(stats.claimStateCounts).length > 0) {
        console.log('\n=== Claim States ===');
        for (const [state, count] of Object.entries(stats.claimStateCounts).sort()) {
          console.log(`  ${state}: ${count}`);
        }
      }
      if (stats.topDegreeNodes.length > 0) {
        console.log(`\n=== Top ${stats.topDegreeNodes.length} Nodes by Degree ===`);
        for (const node of stats.topDegreeNodes) {
          console.log(`  ${node.id} (${node.type}) in=${node.inDegree} out=${node.outDegree}`);
        }
      }
    }
    await store.close();
    return 0;
  }

  const target = positionals[2];
  if (!target) {
    console.error('Usage: diagnose <transcript|extract|editor> <videoIdOrUrl>');
    return 1;
  }
  const videoId = parseVideoId(target);

  if (mode === 'transcript') {
    const useMock = optionBool(options, 'mock');
    const client = useMock
      ? new MockYouTubeClient()
      : new RealYouTubeClient(config.youtube, {
          ...config.ytdlp,
          debugTranscript: config.youtube.debugTranscript,
        });
    const result = await diagnoseTranscript(client, videoId, {
      checkTooling: !useMock,
    });
    if (!result.ok) {
      console.error(result.error.message);
      return 1;
    }
    console.log(formatTranscriptDiagnosis(result.value, optionBool(options, 'json')));
    if (result.value.jsRuntime?.status === 'error') {
      return 2;
    }
    return 0;
  }

  if (mode === 'extract' || mode === 'editor') {
    const store = await openStore(options, config);
    const includeEditor = mode === 'editor' || optionBool(options, 'include-editor');

    // Construct diagnosis options from config directly
    const diagnosisOpts = {
      includeEditor,
      model: config.llm.model || undefined,
      promptVersion: config.extraction.promptVersion || undefined,
      chunkMinutes: config.extraction.chunkMinutes > 0 ? config.extraction.chunkMinutes : undefined,
      maxChunks: config.extraction.maxChunks > 0 ? config.extraction.maxChunks : undefined,
      cacheDir: config.llm.cacheDir || undefined,
      editorVersion: (config.editor.version === 'v2' ? 'v2' : 'v1') as 'v1' | 'v2',
      maxClaims: config.extraction.maxClaims > 0 ? config.extraction.maxClaims : undefined,
      windowMinutes: config.editor.windowMinutes > 0 ? config.editor.windowMinutes : undefined,
      maxPerWindow: config.editor.maxPerWindow > 0 ? config.editor.maxPerWindow : undefined,
      minWindows: config.editor.minWindows > 0 ? config.editor.minWindows : undefined,
      minWords: config.editor.minWords > 0 ? config.editor.minWords : undefined,
      minChars: config.editor.minChars > 0 ? config.editor.minChars : undefined,
    };

    const result = await diagnoseExtraction(store, videoId, diagnosisOpts);

    if (!result.ok) {
      console.error(result.error.message);
      await store.close();
      return 1;
    }
    console.log(formatExtractionDiagnosis(result.value, optionBool(options, 'json')));

    if (includeEditor && result.value.editorial && !result.value.editorial.available) {
      await store.close();
      return 2;
    }
    await store.close();
    return 0;
  }

  console.error('Unknown diagnose mode. Use transcript, extract, editor, or stats.');
  return 1;
}

function parseTags(options: CliOptions): string[] {
  const raw = optionString(options, 'tag', optionString(options, 'tags', ''));
  if (!raw) return [];
  return raw.split(',').map(tag => tag.trim()).filter(Boolean);
}

async function runTask(positionals: string[], options: CliOptions, config: ResolvedConfig): Promise<number> {
  const action = positionals[1];
  if (!action) {
    console.error('Usage: task <create|show> ...');
    return 1;
  }
  const store = await openStore(options, config);

  if (action === 'create') {
    const claimId = optionString(options, 'from-claim', '');
    const title = optionString(options, 'title', '');
    if (!title) {
      console.error('Missing --title "<title>".');
      await store.close();
      return 1;
    }
    const projectId = optionString(options, 'project', '');
    const tags = parseTags(options);
    let result:
      | Awaited<ReturnType<typeof createTaskFromClaim>>
      | Awaited<ReturnType<typeof createTaskStandalone>>;
    if (claimId) {
      result = await createTaskFromClaim(store, {
        claimId,
        title,
        projectId: projectId || undefined,
        tags,
      });
    } else {
      const suggestions = await searchClaims(store, {
        query: title,
        limit: 5,
        states: ['accepted', 'draft'],
      });
      if (!suggestions.ok) {
        console.error(suggestions.error.message);
        await store.close();
        return 1;
      }

      if (suggestions.value.length > 0 && !optionBool(options, 'allow-empty')) {
        console.log('Related claims found. Create from claim to avoid duplicate tasks:');
        for (const hit of suggestions.value) {
          console.log(`- ${hit.claimId} [${hit.timestampLabel}] ${hit.claimText}`);
          if (hit.timestampUrl) console.log(`  ${hit.timestampUrl}`);
        }
        console.log('Re-run with --from-claim <id> or add --allow-empty to create anyway.');
        await store.close();
        return 1;
      }

      result = await createTaskStandalone(store, {
        title,
        projectId: projectId || undefined,
        tags,
      });
    }
    if (!result.ok) {
      console.error(result.error.message);
      await store.close();
      return 1;
    }
    console.log(`Task created: ${result.value.taskId}`);
    if (result.value.createdProject) {
      console.log(`Project created: ${result.value.projectId}`);
    }
  } else if (action === 'show') {
    const taskId = positionals[2];
    if (!taskId) {
      console.error('Usage: task show <taskId>');
      await store.close();
      return 1;
    }
    const context = await getTaskContext(store, taskId);
    if (!context.ok) {
      console.error(context.error.message);
      await store.close();
      return 1;
    }
    console.log(formatTaskContext(context.value));
  } else {
    console.error('Unknown task action. Use create or show.');
    await store.close();
    return 1;
  }

  await store.close();
  return 0;
}

async function runArea(positionals: string[], options: CliOptions, config: ResolvedConfig): Promise<number> {
  const action = positionals[1];
  if (action !== 'create') {
    console.error('Unknown area action. Use create.');
    return 1;
  }
  const name = optionString(options, 'name', '').trim();
  if (!name) {
    console.error('Usage: area create --name "<name>" [--id <id>] [--description "<text>"]');
    return 1;
  }

  const store = await openStore(options, config);
  const result = await createArea(store, {
    id: optionString(options, 'id', '').trim() || undefined,
    name,
    description: optionString(options, 'description', '').trim() || undefined,
  });
  if (!result.ok) {
    console.error(result.error.message);
    await store.close();
    return 1;
  }
  console.log(`Area created: ${result.value.areaId}`);
  await store.close();
  return 0;
}

async function runGoal(positionals: string[], options: CliOptions, config: ResolvedConfig): Promise<number> {
  const action = positionals[1];
  if (action !== 'create') {
    console.error('Unknown goal action. Use create.');
    return 1;
  }
  const name = optionString(options, 'name', '').trim();
  if (!name) {
    console.error('Usage: goal create --name "<name>" [--id <id>] [--description "<text>"] [--area <areaId>]');
    return 1;
  }

  const store = await openStore(options, config);
  const result = await createGoal(store, {
    id: optionString(options, 'id', '').trim() || undefined,
    name,
    description: optionString(options, 'description', '').trim() || undefined,
    areaId: optionString(options, 'area', '').trim() || undefined,
  });
  if (!result.ok) {
    console.error(result.error.message);
    await store.close();
    return 1;
  }
  console.log(`Goal created: ${result.value.goalId}`);
  await store.close();
  return 0;
}

async function runProject(positionals: string[], options: CliOptions, config: ResolvedConfig): Promise<number> {
  const action = positionals[1];
  if (action !== 'create') {
    console.error('Unknown project action. Use create.');
    return 1;
  }
  const name = optionString(options, 'name', '').trim();
  if (!name) {
    console.error(
      'Usage: project create --name "<name>" [--id <id>] [--description "<text>"] [--area <areaId>] [--goal <goalId>]'
    );
    return 1;
  }

  const store = await openStore(options, config);
  const result = await createProject(store, {
    id: optionString(options, 'id', '').trim() || undefined,
    name,
    description: optionString(options, 'description', '').trim() || undefined,
    areaId: optionString(options, 'area', '').trim() || undefined,
    goalId: optionString(options, 'goal', '').trim() || undefined,
  });
  if (!result.ok) {
    console.error(result.error.message);
    await store.close();
    return 1;
  }
  console.log(`Project created: ${result.value.projectId}`);
  await store.close();
  return 0;
}

async function runPreflight(positionals: string[], options: CliOptions, config: ResolvedConfig): Promise<number> {
  const mode = positionals[1];
  if (mode !== 'youtube') {
    console.error('Usage: preflight youtube [--json] [--probe-url <url>]');
    return 1;
  }

  const probeUrl = optionString(options, 'probe-url', '');
  const result = await runYtDlpPreflight(
    { probeUrl: probeUrl || undefined },
    { ...config.ytdlp, debugTranscript: config.youtube.debugTranscript }
  );
  if (!result.ok) {
    console.error(result.error.message);
    return 1;
  }

  if (optionBool(options, 'json')) {
    console.log(JSON.stringify(result.value, null, 2));
    return probeUrl && !result.value.probe.ok ? 1 : 0;
  }

  const lines = [
    'YouTube preflight',
    `yt-dlp: status=${result.value.ytdlp.status} executable=${result.value.ytdlp.executable} version=${result.value.ytdlp.version ?? 'unknown'}`,
    `JS runtimes configured: ${result.value.jsRuntime.configured}`,
    ...result.value.jsRuntime.runtimes.map(runtime =>
      `- ${runtime.label}: ${runtime.available ? 'ok' : 'missing'} (${runtime.executable}${runtime.version ? ` ${runtime.version}` : ''})`
    ),
    `ffmpeg: status=${result.value.ffmpeg.status} executable=${result.value.ffmpeg.executable}`,
  ];
  if (result.value.probe.attempted) {
    lines.push(
      `probe: ${result.value.probe.ok ? 'ok' : 'failed'} url=${result.value.probe.url ?? ''}${result.value.probe.message ? ` message=${result.value.probe.message}` : ''}`
    );
  } else {
    lines.push('probe: skipped (use --probe-url <url> to run network probe)');
  }
  console.log(lines.join('\n'));
  return probeUrl && !result.value.probe.ok ? 1 : 0;
}

function inferVideoIdFromPath(path: string): string | undefined {
  const base = basename(path);
  const match = base.match(/^([A-Za-z0-9_-]{6,})\./);
  return match?.[1];
}

async function runFixtures(positionals: string[], options: CliOptions, config: ResolvedConfig): Promise<number> {
  const mode = positionals[1];
  if (mode !== 'import-ttml') {
    console.error('Usage: fixtures import-ttml <path> [--video-id <id>] [--source-url <url>] [--track <name>] [--out <path>] [--pretty]');
    return 1;
  }
  const inputPath = positionals[2];
  if (!inputPath) {
    console.error('Usage: fixtures import-ttml <path> [--video-id <id>] [--source-url <url>] [--track <name>] [--out <path>] [--pretty]');
    return 1;
  }

  const inferredVideoId = inferVideoIdFromPath(inputPath);
  const videoId = optionString(options, 'video-id', inferredVideoId ?? '');
  if (!videoId) {
    console.error('Missing video id. Provide --video-id or use a file named <videoId>.*.ttml');
    return 1;
  }

  const sourceUrl = optionString(options, 'source-url', `https://www.youtube.com/watch?v=${videoId}`);
  const track = optionString(options, 'track', 'en-orig');
  const pretty = optionBool(options, 'pretty');
  const defaultOut = `./testdata/youtube_golden/${videoId}.excerpts.json`;
  const outPath = optionString(options, 'out', defaultOut);

  try {
    const ttml = await readFile(inputPath, 'utf-8');
    const parsed = parseTranscriptTtml(ttml);
    if (parsed.length === 0) {
      console.error(`No transcript segments parsed from ${inputPath}`);
      return 1;
    }

    const segments = parsed.map((segment, index) => ({
      id: `fixture-${videoId}-${index}`,
      sequence: index,
      start: Number(segment.start.toFixed(3)),
      duration: Number(segment.duration.toFixed(3)),
      text: segment.text,
    }));

    const hash = createHash('sha256');
    for (const segment of segments) {
      hash.update(`${segment.start}|${segment.duration}|${segment.text}`);
    }

    const payload = {
      fixtureVersion: 1,
      videoId,
      sourceUrl,
      transcriptTrack: track,
      parser: 'parseTranscriptTtml',
      transcriptHash: hash.digest('hex'),
      segmentCount: segments.length,
      segments,
    };

    await ensureDir(dirname(outPath));
    await writeFile(outPath, JSON.stringify(payload, null, pretty ? 2 : undefined) + '\n', 'utf-8');
    console.log(`Wrote fixture: ${resolve(outPath)}`);
    return 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

export async function runCli(argv: string[] = process.argv.slice(2)): Promise<number> {
  const parsed = parseArgs(argv);
  const [command] = parsed.positionals;
  if (parsed.options['help'] === true) {
    printHelp();
    return 0;
  }

  if (!command || command === 'help' || command === '--help') {
    printHelp();
    return 0;
  }

  const cliOverrides = buildCliOverrides(parsed.options);

  const resolution = await resolveCliConfig({
    configPath: typeof parsed.options['config'] === 'string' ? parsed.options['config'] : undefined,
    profile: typeof parsed.options['profile'] === 'string' ? parsed.options['profile'] : undefined,
    source: resolveSourceId(parsed.positionals, parsed.options),
    cliOverrides,
  });

  const loadResult = resolution.loadResult;
  let config: ResolvedConfig | undefined;

  if (resolution.ok) {
    config = resolution.config;
  } else {
    if (command === 'config') {
      // Phase 2A Round 7: Config commands handle their own errors.
      // We pass the (possibly failed) loadResult to runConfig.
    } else {
      throw resolution.error;
    }
  }

  if (!config && command !== 'config') {
    // This should be unreachable if resolution.ok is true, but satisfies type checker
    console.error('Configuration not loaded.');
    return 1;
  }

  let exitCode = 0;
  switch (command) {
    case 'ingest':
      exitCode = await runIngest(parsed.positionals, parsed.options, config!);
      break;
    case 'extract':
      exitCode = await runExtract(parsed.positionals, parsed.options, config!);
      break;
    case 'claims':
      exitCode = await runClaims(parsed.positionals, parsed.options, config!);
      break;
    case 'export':
      exitCode = await runExport(parsed.positionals, parsed.options, config!);
      break;
    case 'query':
      exitCode = await runQuery(parsed.positionals, parsed.options, config!);
      break;
    case 'related':
      exitCode = await runRelated(parsed.positionals, parsed.options, config!);
      break;
    case 'review':
      exitCode = await runReview(parsed.positionals, parsed.options, config!);
      break;
    case 'task':
      exitCode = await runTask(parsed.positionals, parsed.options, config!);
      break;
    case 'area':
      exitCode = await runArea(parsed.positionals, parsed.options, config!);
      break;
    case 'goal':
      exitCode = await runGoal(parsed.positionals, parsed.options, config!);
      break;
    case 'project':
      exitCode = await runProject(parsed.positionals, parsed.options, config!);
      break;
    case 'diagnose':
      exitCode = await runDiagnose(parsed.positionals, parsed.options, config!);
      break;
    case 'preflight':
      exitCode = await runPreflight(parsed.positionals, parsed.options, config!);
      break;
    case 'fixtures':
      exitCode = await runFixtures(parsed.positionals, parsed.options, config!);
      break;
    case 'eval':
      exitCode = await runEvalMatrix(parsed.positionals, parsed.options, config!);
      break;
    case 'config': {
      // config <subcommand> -> positionals[1]
      // loadResult is always populated (full or partial). config may be undefined.
      // Pass error if resolution failed.
      const error = !resolution.ok ? resolution.error : undefined;
      exitCode = await runConfig(parsed.positionals.slice(1), parsed.options, loadResult, config, error);
      break;
    }
    default:
      console.error(`Unknown command: ${command}`);
      printHelp();
      exitCode = 1;
  }

  return exitCode;
}

if (isCliEntrypoint(import.meta.url, process.argv[1])) {
  runCli().then(
    code => process.exit(code),
    err => {
      // Log only sanitized error information to avoid leaking sensitive data.
      // ENV_VERBOSE enables error name prefix but never prints full stacks.
      if (err instanceof Error) {
        const basicMessage = sanitizeErrorMessage(err.message || 'Unexpected error');
        if (VERBOSE) {
          console.error(`${ERROR_PREFIX} ${err.name}: ${basicMessage}`);
        } else {
          console.error(basicMessage);
        }
      } else {
        const message = sanitizeErrorMessage(String(err));
        console.error(VERBOSE ? `${ERROR_PREFIX} ${message}` : message);
      }
      process.exit(1);
    }
  );
}
