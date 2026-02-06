#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { InMemoryRegistry } from '@aidha/taxonomy';
import { SQLiteStore } from '@aidha/graph-backend';
import {
  MockYouTubeClient,
  RealYouTubeClient,
  IngestionPipeline,
  ClaimExtractionPipeline,
  LlmClaimExtractor,
  createDefaultLlmClient,
  ReferenceExtractionPipeline,
  DossierExporter,
  searchClaims,
  createTaskFromClaim,
  getTaskContext,
  formatTaskContext,
  normalizeProjectIdForCli,
} from './index.js';
import { parseArgs } from './cli/parse.js';
import { formatIngestionStatus } from './cli/status.js';

type CliOptions = Record<string, string | boolean>;

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

function optionString(options: CliOptions, key: string, fallback: string): string {
  const value = options[key];
  return typeof value === 'string' && value.length > 0 ? value : fallback;
}

function optionNumber(options: CliOptions, key: string, fallback: number): number {
  const value = options[key];
  if (typeof value === 'string') {
    const parsed = Number.parseInt(value, 10);
    return Number.isNaN(parsed) ? fallback : parsed;
  }
  return fallback;
}

function optionBool(options: CliOptions, key: string): boolean {
  return options[key] === true;
}

async function ensureDir(path: string): Promise<void> {
  await mkdir(path, { recursive: true });
}

function printHelp(): void {
  console.log(`AIDHA YouTube CLI

Usage:
  aidha-youtube ingest playlist <playlistIdOrUrl> [--db <path>] [--mock] [--ytdlp-keep] [--ytdlp-cookies <path>] [--ytdlp-bin <path>] [--ytdlp-timeout <ms>]
  aidha-youtube ingest video <videoIdOrUrl> [--db <path>] [--mock] [--ytdlp-keep] [--ytdlp-cookies <path>] [--ytdlp-bin <path>] [--ytdlp-timeout <ms>]
  aidha-youtube ingest status <videoIdOrUrl> [--db <path>] [--json]
  aidha-youtube extract claims <videoIdOrUrl> [--db <path>] [--llm] [--model <id>] [--claims <n>] [--chunk-minutes <n>] [--max-chunks <n>]
  aidha-youtube extract refs <videoIdOrUrl> [--db <path>]
  aidha-youtube export dossier video <videoIdOrUrl> [--db <path>] [--out <path>]
  aidha-youtube export dossier playlist <playlistIdOrUrl> [--db <path>] [--out <path>] [--videos <id1,id2>]
  aidha-youtube query <text...> [--db <path>] [--limit <n>] [--project <id>] [--area <id>] [--goal <id>]
  aidha-youtube task create --from-claim <claimId> --title "<title>" [--project <id>] [--tag <a,b>] [--db <path>]
  aidha-youtube task show <taskId> [--db <path>]

Defaults:
  --db ./out/aidha.sqlite
  --out ./out/dossier-<id>.md
`);
}

async function openStore(options: CliOptions): Promise<SQLiteStore> {
  const dbPath = optionString(options, 'db', './out/aidha.sqlite');
  await ensureDir(dirname(dbPath));
  return SQLiteStore.open(dbPath);
}

async function runIngest(positionals: string[], options: CliOptions): Promise<number> {
  const mode = positionals[1];
  const target = positionals[2];
  if (!mode || !target) {
    console.error('Usage: ingest <playlist|video> <idOrUrl>');
    return 1;
  }
  if (optionBool(options, 'ytdlp-keep')) {
    process.env['AIDHA_YTDLP_KEEP_FILES'] = '1';
  }
  const ytdlpCookies = optionString(options, 'ytdlp-cookies', '');
  if (ytdlpCookies) {
    process.env['AIDHA_YTDLP_COOKIES_FILE'] = ytdlpCookies;
  }
  const ytdlpBin = optionString(options, 'ytdlp-bin', '');
  if (ytdlpBin) {
    process.env['AIDHA_YTDLP_BIN'] = ytdlpBin;
  }
  const ytdlpTimeout = optionNumber(options, 'ytdlp-timeout', 0);
  if (ytdlpTimeout > 0) {
    process.env['AIDHA_YTDLP_TIMEOUT_MS'] = String(ytdlpTimeout);
  }
  const store = await openStore(options);
  const taxonomyRegistry = new InMemoryRegistry();
  const client = optionBool(options, 'mock') ? new MockYouTubeClient() : new RealYouTubeClient();
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

async function runExtract(positionals: string[], options: CliOptions): Promise<number> {
  const mode = positionals[1];
  const videoArg = positionals[2];
  if (!mode || !videoArg) {
    console.error('Usage: extract <claims|refs> <videoIdOrUrl>');
    return 1;
  }
  const videoId = parseVideoId(videoArg);
  const store = await openStore(options);

  if (mode === 'claims') {
    const useLlm = optionBool(options, 'llm');
    const maxClaims = optionNumber(options, 'claims', 0);
    const chunkMinutes = optionNumber(options, 'chunk-minutes', 0);
    const maxChunks = optionNumber(options, 'max-chunks', 0);
    let extractor: LlmClaimExtractor | undefined;
    if (useLlm) {
      const model = optionString(options, 'model', process.env['AIDHA_LLM_MODEL'] ?? '');
      if (!model) {
        console.error('Missing LLM model. Provide --model or set AIDHA_LLM_MODEL.');
        await store.close();
        return 1;
      }
      const clientResult = createDefaultLlmClient();
      if (!clientResult.ok) {
        console.error(clientResult.error.message);
        await store.close();
        return 1;
      }
      extractor = new LlmClaimExtractor({
        client: clientResult.value,
        model,
        promptVersion: process.env['AIDHA_CLAIMS_PROMPT_VERSION'] ?? 'v1',
        chunkMinutes: chunkMinutes > 0 ? chunkMinutes : undefined,
        maxChunks: maxChunks > 0 ? maxChunks : undefined,
        cacheDir: process.env['AIDHA_LLM_CACHE_DIR'],
      });
    }

    const pipeline = new ClaimExtractionPipeline({ graphStore: store, extractor });
    const result = await pipeline.extractClaimsForVideo(videoId, {
      maxClaims: maxClaims > 0 ? maxClaims : undefined,
    });
    if (!result.ok) {
      console.error(result.error.message);
      await store.close();
      return 1;
    }
    console.log(`Claims: created=${result.value.claimsCreated} updated=${result.value.claimsUpdated} noop=${result.value.claimsNoop}`);
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

async function runExport(positionals: string[], options: CliOptions): Promise<number> {
  const entity = positionals[2];
  const target = positionals[3];
  if (!entity || !target) {
    console.error('Usage: export dossier <video|playlist> <idOrUrl>');
    return 1;
  }

  const store = await openStore(options);
  const exporter = new DossierExporter({ graphStore: store });

  if (entity === 'video') {
    const videoId = parseVideoId(target);
    const result = await exporter.renderVideoDossier(videoId);
    if (!result.ok) {
      console.error(result.error.message);
      await store.close();
      return 1;
    }
    const outPath = optionString(options, 'out', `./out/dossier-${videoId}.md`);
    await ensureDir(dirname(outPath));
    await writeFile(outPath, result.value, 'utf-8');
    console.log(`Wrote dossier: ${resolve(outPath)}`);
  } else if (entity === 'playlist') {
    const playlistId = parsePlaylistId(target);
    let videoIds: string[] = [];
    const videosOption = options['videos'];
    if (typeof videosOption === 'string' && videosOption.length > 0) {
      videoIds = videosOption.split(',').map(v => v.trim()).filter(Boolean);
    } else {
      const client = optionBool(options, 'mock') ? new MockYouTubeClient() : new RealYouTubeClient();
      const playlistResult = await client.fetchPlaylist(playlistId);
      if (!playlistResult.ok) {
        console.error(playlistResult.error.message);
        await store.close();
        return 1;
      }
      videoIds = playlistResult.value.videoIds;
    }

    const result = await exporter.renderPlaylistDossier({
      playlistId,
      title: undefined,
      url: `https://www.youtube.com/playlist?list=${playlistId}`,
      videoIds,
    });
    if (!result.ok) {
      console.error(result.error.message);
      await store.close();
      return 1;
    }
    const outPath = optionString(options, 'out', `./out/dossier-playlist-${playlistId}.md`);
    await ensureDir(dirname(outPath));
    await writeFile(outPath, result.value, 'utf-8');
    console.log(`Wrote dossier: ${resolve(outPath)}`);
  } else {
    console.error('Unknown export target. Use video or playlist.');
    await store.close();
    return 1;
  }

  await store.close();
  return 0;
}

async function runQuery(positionals: string[], options: CliOptions): Promise<number> {
  const queryText = positionals.slice(1).join(' ').trim();
  if (!queryText) {
    console.error('Usage: query <text>');
    return 1;
  }
  const store = await openStore(options);
  const limit = optionNumber(options, 'limit', 10);
  const project = optionString(options, 'project', '');
  const area = optionString(options, 'area', '');
  const goal = optionString(options, 'goal', '');
  const result = await searchClaims(store, {
    query: queryText,
    limit,
    projectId: project ? normalizeProjectIdForCli(project) : undefined,
    areaId: area || undefined,
    goalId: goal || undefined,
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

function parseTags(options: CliOptions): string[] {
  const raw = optionString(options, 'tag', optionString(options, 'tags', ''));
  if (!raw) return [];
  return raw.split(',').map(tag => tag.trim()).filter(Boolean);
}

async function runTask(positionals: string[], options: CliOptions): Promise<number> {
  const action = positionals[1];
  if (!action) {
    console.error('Usage: task <create|show> ...');
    return 1;
  }
  const store = await openStore(options);

  if (action === 'create') {
    const claimId = optionString(options, 'from-claim', '');
    if (!claimId) {
      console.error('Missing --from-claim <claimId>.');
      await store.close();
      return 1;
    }
    const title = optionString(options, 'title', '');
    if (!title) {
      console.error('Missing --title "<title>".');
      await store.close();
      return 1;
    }
    const projectId = optionString(options, 'project', '');
    const tags = parseTags(options);
    const result = await createTaskFromClaim(store, {
      claimId,
      title,
      projectId: projectId || undefined,
      tags,
    });
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

async function main() {
  const parsed = parseArgs(process.argv.slice(2));
  const [command] = parsed.positionals;

  if (!command || command === 'help' || command === '--help') {
    printHelp();
    process.exit(0);
  }

  let exitCode = 0;
  switch (command) {
    case 'ingest':
      exitCode = await runIngest(parsed.positionals, parsed.options);
      break;
    case 'extract':
      exitCode = await runExtract(parsed.positionals, parsed.options);
      break;
    case 'export':
      if (parsed.positionals[1] !== 'dossier') {
        console.error('Usage: export dossier <video|playlist> <idOrUrl>');
        exitCode = 1;
      } else {
        exitCode = await runExport(parsed.positionals, parsed.options);
      }
      break;
    case 'query':
      exitCode = await runQuery(parsed.positionals, parsed.options);
      break;
    case 'task':
      exitCode = await runTask(parsed.positionals, parsed.options);
      break;
    default:
      console.error(`Unknown command: ${command}`);
      printHelp();
      exitCode = 1;
  }

  process.exit(exitCode);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
