#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { SQLiteStore } from '../../packages/reconditum/dist/index.js';
import { InMemoryRegistry } from '../../packages/phyla/dist/index.js';
import {
  MockYouTubeClient,
  IngestionPipeline,
  ClaimExtractionPipeline,
  LlmClaimExtractor,
  ReferenceExtractionPipeline,
  DossierExporter,
  searchClaims,
} from '../../packages/praecis/youtube/dist/index.js';

function arg(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;
  return process.argv[index + 1];
}

const dbPath = arg('--db');
const dossierOut = arg('--dossier-out');
const transcriptOut = arg('--transcript-out');
const summaryOut = arg('--summary-out');

if (!dbPath || !dossierOut || !transcriptOut || !summaryOut) {
  console.error('Usage: llm-offline-acceptance.mjs --db <path> --dossier-out <path> --transcript-out <path> --summary-out <path>');
  process.exit(2);
}

const mockLlmClient = {
  async generate(request) {
    const user = request?.user ?? '';
    const rewrite = typeof user === 'string' && user.includes('Revise each claim');
    const payload = rewrite
      ? {
          claims: [
            { index: 0, text: 'Use TypeScript to improve maintainability and catch errors earlier in development.' },
            { index: 1, text: 'The tutorial opens with practical context for learning the topic.' },
          ],
        }
      : {
          claims: [
            {
              text: 'Use TypeScript to improve maintainability and catch errors earlier in development.',
              excerptIds: ['youtube-test-video-excerpt-1'],
              startSeconds: 5,
              type: 'insight',
              confidence: 0.89,
              why: 'Highlights concrete engineering benefit from transcript evidence.',
            },
            {
              text: 'The speaker frames the tutorial as a practical introduction to the topic.',
              excerptIds: ['youtube-test-video-excerpt-0'],
              startSeconds: 0,
              type: 'summary',
              confidence: 0.81,
              why: 'Summarizes opening context with explicit provenance.',
            },
          ],
        };

    return { ok: true, value: JSON.stringify(payload) };
  },
};

const store = SQLiteStore.open(dbPath);
const registry = new InMemoryRegistry();

try {
  const youtubeClient = new MockYouTubeClient();
  const ingestion = new IngestionPipeline({
    graphStore: store,
    taxonomyRegistry: registry,
    youtubeClient,
  });

  const ingest = await ingestion.ingestVideo('test-video');
  if (!ingest.ok) throw ingest.error;

  const extractor = new LlmClaimExtractor({
    client: mockLlmClient,
    model: 'mock-acceptance-model',
    promptVersion: 'acceptance-v1',
    maxClaims: 10,
    chunkMinutes: 5,
    maxChunks: 10,
    editorVersion: 'v2',
    editorLlm: true,
    editorMinWords: 5,
    editorMinChars: 20,
    cacheDir: './.cache/acceptance-20260220/cache',
  });

  const claimsPipeline = new ClaimExtractionPipeline({ graphStore: store, extractor });
  const claims = await claimsPipeline.extractClaimsForVideo('test-video', { maxClaims: 10 });
  if (!claims.ok) throw claims.error;

  const refsPipeline = new ReferenceExtractionPipeline({ graphStore: store });
  const refs = await refsPipeline.extractReferencesForVideo('test-video');
  if (!refs.ok) throw refs.error;

  const exporter = new DossierExporter({ graphStore: store });
  const dossier = await exporter.renderVideoDossier('test-video', { states: ['accepted', 'draft'] });
  if (!dossier.ok) throw dossier.error;

  const transcript = await exporter.exportTranscriptJson('test-video', { pretty: true });
  if (!transcript.ok) throw transcript.error;

  const query = await searchClaims(store, { query: 'TypeScript', limit: 5, states: ['accepted', 'draft'] });
  if (!query.ok) throw query.error;

  await mkdir(dirname(dossierOut), { recursive: true });
  await mkdir(dirname(transcriptOut), { recursive: true });
  await mkdir(dirname(summaryOut), { recursive: true });

  await writeFile(dossierOut, dossier.value, 'utf-8');
  await writeFile(transcriptOut, transcript.value, 'utf-8');

  const summary = {
    lane: 'llm-offline-acceptance',
    ingest: ingest.value,
    claims: claims.value,
    refs: refs.value,
    queryHits: query.value.length,
    hitIds: query.value.map(hit => hit.claimId),
  };
  await writeFile(summaryOut, JSON.stringify(summary, null, 2) + '\n', 'utf-8');
  console.log(JSON.stringify(summary));
} finally {
  await store.close();
  await registry.close();
}
