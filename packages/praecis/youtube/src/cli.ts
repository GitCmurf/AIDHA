#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
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
import { parseArgs } from './cli/parse.js';
import { CLI_USAGE_TEXT } from './cli/help.js';
import { formatIngestionStatus } from './cli/status.js';
import type { ClaimState } from './utils/claim-state.js';
import type { Result } from './pipeline/types.js';
import { runYtDlpPreflight } from './client/yt-dlp.js';
import { parseTranscriptTtml } from './client/transcript.js';

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

function deriveDraftPath(path: string): string {
  if (path.endsWith('.draft.md')) return path;
  if (path.endsWith('.md')) return path.slice(0, -3) + '.draft.md';
  return `${path}.draft.md`;
}

function printHelp(): void {
  console.log(CLI_USAGE_TEXT);
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
  const ytdlpJsRuntimes = optionString(options, 'ytdlp-js-runtimes', '');
  if (ytdlpJsRuntimes) {
    process.env['AIDHA_YTDLP_JS_RUNTIMES'] = ytdlpJsRuntimes;
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
    const editorVersionOption = optionString(
      options,
      'editor-version',
      process.env['AIDHA_EDITOR_VERSION'] ?? 'v1'
    ).toLowerCase();
    const editorVersion = editorVersionOption === 'v2' ? 'v2' : 'v1';
    const editorWindowMinutes = optionNumber(options, 'window-minutes', 0);
    const editorMaxPerWindow = optionNumber(options, 'max-per-window', 0);
    const editorMinWindows = optionNumber(options, 'min-windows', 0);
    const editorMinWords = optionNumber(options, 'min-words', 0);
    const editorMinChars = optionNumber(options, 'min-chars', 0);
    const editorLlm = optionBool(options, 'editor-llm');
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
        editorVersion,
        editorWindowMinutes: editorWindowMinutes > 0 ? editorWindowMinutes : undefined,
        editorMaxPerWindow: editorMaxPerWindow > 0 ? editorMaxPerWindow : undefined,
        editorMinWindows: editorMinWindows > 0 ? editorMinWindows : undefined,
        editorMinWords: editorMinWords > 0 ? editorMinWords : undefined,
        editorMinChars: editorMinChars > 0 ? editorMinChars : undefined,
        editorLlm,
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
  const kind = positionals[1];
  const entity = positionals[2];
  const target = positionals[3];
  if (!kind || !entity || !target) {
    console.error('Usage: export <dossier|transcript> <video|playlist> <idOrUrl>');
    return 1;
  }

  const store = await openStore(options);
  const exporter = new DossierExporter({ graphStore: store });
  const splitStates = optionBool(options, 'split-states');
  const states = parseClaimStates(options);
  const pretty = optionBool(options, 'pretty');

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
      const client = optionBool(options, 'mock') ? new MockYouTubeClient() : new RealYouTubeClient();
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
    const outPath = optionString(options, 'out', `./out/dossier-${videoId}.md`);
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
    const outPath = optionString(options, 'out', `./out/dossier-playlist-${playlistInput.value.playlistId}.md`);
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
    const outPath = optionString(options, 'out', `./out/transcript-${videoId}.json`);
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
      `./out/transcript-playlist-${playlistInput.value.playlistId}.json`
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

async function runRelated(positionals: string[], options: CliOptions): Promise<number> {
  const claimId = optionString(options, 'claim', '');
  if (!claimId) {
    console.error('Usage: related --claim <claimId>');
    return 1;
  }
  const store = await openStore(options);
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

async function runReview(positionals: string[], options: CliOptions): Promise<number> {
  const action = positionals[1];
  if (!action) {
    console.error('Usage: review <next|apply> ...');
    return 1;
  }
  const store = await openStore(options);

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

async function runDiagnose(positionals: string[], options: CliOptions): Promise<number> {
  const mode = positionals[1];
  const target = positionals[2];
  if (!mode || !target) {
    console.error('Usage: diagnose <transcript|extract> <videoIdOrUrl>');
    return 1;
  }
  const videoId = parseVideoId(target);

  if (mode === 'transcript') {
    const useMock = optionBool(options, 'mock');
    const client = useMock ? new MockYouTubeClient() : new RealYouTubeClient();
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

  if (mode === 'extract') {
    const store = await openStore(options);
    const includeEditor = optionBool(options, 'include-editor');
    const editorVersionOption = optionString(
      options,
      'editor-version',
      process.env['AIDHA_EDITOR_VERSION'] ?? 'v1'
    ).toLowerCase();
    const editorVersion = editorVersionOption === 'v2' ? 'v2' : 'v1';
    const result = await diagnoseExtraction(store, videoId, {
      includeEditor,
      model: optionString(options, 'model', process.env['AIDHA_LLM_MODEL'] ?? '') || undefined,
      promptVersion: optionString(
        options,
        'prompt-version',
        process.env['AIDHA_CLAIMS_PROMPT_VERSION'] ?? ''
      ) || undefined,
      chunkMinutes: optionNumber(options, 'chunk-minutes', 0) || undefined,
      maxChunks: optionNumber(options, 'max-chunks', 0) || undefined,
      cacheDir: optionString(options, 'cache-dir', process.env['AIDHA_LLM_CACHE_DIR'] ?? '') || undefined,
      editorVersion,
      maxClaims: optionNumber(options, 'claims', 0) || undefined,
      windowMinutes: optionNumber(options, 'window-minutes', 0) || undefined,
      maxPerWindow: optionNumber(options, 'max-per-window', 0) || undefined,
      minWindows: optionNumber(options, 'min-windows', 0) || undefined,
      minWords: optionNumber(options, 'min-words', 0) || undefined,
      minChars: optionNumber(options, 'min-chars', 0) || undefined,
    });
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

  if (mode === 'editor') {
    const store = await openStore(options);
    const editorVersionOption = optionString(
      options,
      'editor-version',
      process.env['AIDHA_EDITOR_VERSION'] ?? 'v1'
    ).toLowerCase();
    const editorVersion = editorVersionOption === 'v2' ? 'v2' : 'v1';
    const result = await diagnoseExtraction(store, videoId, {
      includeEditor: true,
      model: optionString(options, 'model', process.env['AIDHA_LLM_MODEL'] ?? '') || undefined,
      promptVersion: optionString(
        options,
        'prompt-version',
        process.env['AIDHA_CLAIMS_PROMPT_VERSION'] ?? ''
      ) || undefined,
      chunkMinutes: optionNumber(options, 'chunk-minutes', 0) || undefined,
      maxChunks: optionNumber(options, 'max-chunks', 0) || undefined,
      cacheDir: optionString(options, 'cache-dir', process.env['AIDHA_LLM_CACHE_DIR'] ?? '') || undefined,
      editorVersion,
      maxClaims: optionNumber(options, 'claims', 0) || undefined,
      windowMinutes: optionNumber(options, 'window-minutes', 0) || undefined,
      maxPerWindow: optionNumber(options, 'max-per-window', 0) || undefined,
      minWindows: optionNumber(options, 'min-windows', 0) || undefined,
      minWords: optionNumber(options, 'min-words', 0) || undefined,
      minChars: optionNumber(options, 'min-chars', 0) || undefined,
    });
    if (!result.ok) {
      console.error(result.error.message);
      await store.close();
      return 1;
    }
    console.log(formatExtractionDiagnosis(result.value, optionBool(options, 'json')));
    if (!result.value.editorial?.available) {
      await store.close();
      return 2;
    }
    await store.close();
    return 0;
  }

  console.error('Unknown diagnose mode. Use transcript, extract, or editor.');
  return 1;
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

async function runArea(positionals: string[], options: CliOptions): Promise<number> {
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

  const store = await openStore(options);
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

async function runGoal(positionals: string[], options: CliOptions): Promise<number> {
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

  const store = await openStore(options);
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

async function runProject(positionals: string[], options: CliOptions): Promise<number> {
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

  const store = await openStore(options);
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

async function runPreflight(positionals: string[], options: CliOptions): Promise<number> {
  const mode = positionals[1];
  if (mode !== 'youtube') {
    console.error('Usage: preflight youtube [--json] [--probe-url <url>]');
    return 1;
  }

  const probeUrl = optionString(options, 'probe-url', '');
  const result = await runYtDlpPreflight({
    probeUrl: probeUrl || undefined,
  });
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

async function runFixtures(positionals: string[], options: CliOptions): Promise<number> {
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

  let exitCode = 0;
  switch (command) {
    case 'ingest':
      exitCode = await runIngest(parsed.positionals, parsed.options);
      break;
    case 'extract':
      exitCode = await runExtract(parsed.positionals, parsed.options);
      break;
    case 'export':
      exitCode = await runExport(parsed.positionals, parsed.options);
      break;
    case 'query':
      exitCode = await runQuery(parsed.positionals, parsed.options);
      break;
    case 'related':
      exitCode = await runRelated(parsed.positionals, parsed.options);
      break;
    case 'review':
      exitCode = await runReview(parsed.positionals, parsed.options);
      break;
    case 'task':
      exitCode = await runTask(parsed.positionals, parsed.options);
      break;
    case 'area':
      exitCode = await runArea(parsed.positionals, parsed.options);
      break;
    case 'goal':
      exitCode = await runGoal(parsed.positionals, parsed.options);
      break;
    case 'project':
      exitCode = await runProject(parsed.positionals, parsed.options);
      break;
    case 'diagnose':
      exitCode = await runDiagnose(parsed.positionals, parsed.options);
      break;
    case 'preflight':
      exitCode = await runPreflight(parsed.positionals, parsed.options);
      break;
    case 'fixtures':
      exitCode = await runFixtures(parsed.positionals, parsed.options);
      break;
    default:
      console.error(`Unknown command: ${command}`);
      printHelp();
      exitCode = 1;
  }

  return exitCode;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  runCli().then(
    code => process.exit(code),
    err => {
      console.error(err);
      process.exit(1);
    }
  );
}
