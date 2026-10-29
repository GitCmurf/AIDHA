import { afterEach, expect, it, vi } from 'vitest';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SQLiteStore } from '@aidha/graph-backend';
import { KeywordTaxonomyClassifier, type ClassificationRequest } from '@aidha/praecis-core';
import { RealYouTubeClient } from '../src/client/youtube.js';
import { ingestYouTubeVideo } from '../src/ingest/runtime-ingestion.js';
import { runCli } from '../src/cli.js';
import { createFixtureLlm, fixtureConfig } from './helpers/runtime-ingestion.js';
import type { CreatorNoteAcquisition } from '../src/schema/creator-note.js';

const directories: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true });
});

it.each(['Legacy guide B: https://example.test/b', ''])('keeps fresh unqualified legacy text coherent after a failed capture: %s', async legacy => {
  const directory = await mkdtemp(join(tmpdir(), 'aidha-creator-transition-'));
  directories.push(directory);
  const videoId = 'legacyguide';
  const resourceId = `youtube-${videoId}`;
  const db = join(directory, 'graph.sqlite');
  const config = fixtureConfig();
  config.db = db;
  config.llm.cacheDir = join(directory, 'cache');
  const client = new RealYouTubeClient();
  vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Unexpected HTTP request'));
  const fetchVideo = vi.spyOn(client, 'fetchVideo');
  vi.spyOn(client, 'fetchTranscript').mockResolvedValue({ ok: true, value: {
    videoId, language: 'en', fullText: 'The guide retains failed measurements.',
    segments: [{ start: 0, duration: 10, text: 'The guide retains failed measurements.' }],
  } });
  let minute = 0;
  async function ingest(description: string | undefined, acquisition?: CreatorNoteAcquisition) {
    fetchVideo.mockResolvedValue({ ok: true, value: {
      id: videoId, title: 'Fictional source', channelId: 'UC-fixture', channelName: 'Fixture author',
      duration: 10, ...(description === undefined ? {} : { description }),
      ...(acquisition ? { creatorNoteAcquisition: acquisition } : {}),
    } });
    const now = new Date(`2026-10-18T16:${String(minute++).padStart(2, '0')}:00.000Z`);
    const store = SQLiteStore.open(db);
    try {
      const result = await ingestYouTubeVideo({ store, client, config, llm: createFixtureLlm(),
        services: { clock: { now: () => now } } }, videoId);
      if (!result.ok) throw result.error;
    } finally { await store.close(); }
  }
  async function persisted() {
    const store = SQLiteStore.open(db);
    try {
      const read = await store.getNode(resourceId);
      if (!read.ok || !read.value) throw new Error('Missing reopened source');
      return { description: read.value.metadata['description'],
        capture: read.value.metadata['creatorNoteCapture'],
        attempt: read.value.metadata['creatorNoteCaptureAttempt'] };
    } finally { await store.close(); }
  }
  await ingest('Captured guide A: https://example.test/a', { state: 'available' });
  const captured = await persisted();
  await ingest(undefined, { state: 'failed', reason: 'timeout' });
  const failed = await persisted();
  expect(failed.description).toBe(captured.description);
  expect(failed.capture).toEqual(captured.capture);
  await ingest(legacy);
  const before = await persisted();
  const path = join(directory, 'config.yaml');
  await writeFile(path, `config_version: 1\ndefault_profile: fixture\nprofiles:\n  fixture:\n    db: ${JSON.stringify(db)}\n    extensions:\n      taxonomy:\n        tags: []\n    llm:\n      model: ""\n      cache_dir: ${JSON.stringify(join(directory, 'cli-cache'))}\n`);
  await chmod(path, 0o600);
  vi.stubEnv('AIDHA_CONFIG', undefined);
  const contexts: Array<string | undefined> = [];
  const classify = KeywordTaxonomyClassifier.prototype.classify;
  vi.spyOn(KeywordTaxonomyClassifier.prototype, 'classify').mockImplementation(function (
    this: KeywordTaxonomyClassifier, request: ClassificationRequest,
  ) {
    contexts.push(request.context.sourceSummary);
    return classify.call(this, request);
  });
  vi.spyOn(console, 'log').mockImplementation(() => {});
  expect(await runCli(['extract', 'claims', videoId, '--config', path, '--mock'])).toBe(0);
  expect(contexts.length).toBeGreaterThan(0);
  const after = await persisted();
  expect({ before, after, cachedSummary: contexts.at(-1) }).toEqual({
    before: { description: legacy, capture: null, attempt: null },
    after: { description: legacy, capture: null, attempt: null },
    cachedSummary: ['Fictional source', 'Channel: Fixture author', legacy].filter(Boolean).join('\n'),
  });
  expect(globalThis.fetch).not.toHaveBeenCalled();
}, 60_000);
