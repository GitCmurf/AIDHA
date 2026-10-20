import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SQLiteStore } from '@aidha/graph-backend';
import { RealYouTubeClient } from '../src/client/youtube.js';
import { ingestYouTubeVideo } from '../src/ingest/runtime-ingestion.js';
import { createFixtureLlm, fixtureConfig } from './helpers/runtime-ingestion.js';

const directories: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true });
});

// Regression for source-owned metadata refresh after deduplication into an existing alias.
it('records the current failed attempt after repeated acquisition into an existing alias', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'aidha-creator-alias-refresh-'));
  directories.push(directory);
  const db = join(directory, 'graph.sqlite');
  const videoId = 'aliasguide1';
  const canonicalId = `youtube-${videoId}`;
  const aliasId = 'existing-fictional-alias';
  const description = 'Captured guide A: https://example.test/a';
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
  const seed = SQLiteStore.open(db);
  try {
    const result = await seed.upsertNode('Resource', aliasId, { label: 'Existing fictional alias',
      metadata: { canonicalId: aliasId, dedupKeys: [canonicalId], sourceType: 'web', provenances: [] } });
    if (!result.ok) throw result.error;
  } finally { await seed.close(); }
  for (const failed of [false, true]) {
    fetchVideo.mockResolvedValue({ ok: true, value: {
      id: videoId, title: 'Fictional source', channelId: 'UC-fixture', channelName: 'Fixture author', duration: 10,
      ...(failed ? { creatorNoteAcquisition: { state: 'failed', reason: 'timeout' } as const }
        : { description, creatorNoteAcquisition: { state: 'available' } as const }),
    } });
    const store = SQLiteStore.open(db);
    try {
      const result = await ingestYouTubeVideo({ store, client, config, llm: createFixtureLlm(),
        services: { clock: { now: () => new Date(failed ? '2026-10-18T16:01:00.000Z' : '2026-10-18T16:00:00.000Z') } } }, videoId);
      if (!result.ok) throw result.error;
      expect(result.value.nodeId).toBe(aliasId);
    } finally { await store.close(); }
  }
  const reopened = SQLiteStore.open(db);
  try {
    const read = await reopened.getNode(aliasId);
    if (!read.ok || !read.value) throw new Error('Missing reopened alias');
    expect(read.value.metadata['description']).toBe(description);
    expect(read.value.metadata['creatorNoteCapture']).toMatchObject({ sourceCanonicalId: canonicalId });
    expect(read.value.metadata['creatorNoteCaptureAttempt']).toEqual({
      schemaVersion: 1, method: 'yt-dlp', state: 'failed', reason: 'timeout', attemptedAt: '2026-10-18T16:01:00.000Z',
    });
  } finally { await reopened.close(); }
  expect(globalThis.fetch).not.toHaveBeenCalled();
}, 60_000);
