import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SQLiteStore } from '@aidha/graph-backend';
import { KeywordTaxonomyClassifier, type ClassificationRequest } from '@aidha/praecis-core';
import { RealYouTubeClient } from '../src/client/youtube.js';
import { ingestYouTubeVideo } from '../src/ingest/runtime-ingestion.js';
import { createFixtureLlm, fixtureConfig } from './helpers/runtime-ingestion.js';
import type { CreatorNoteAcquisition } from '../src/schema/creator-note.js';

const directories: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true });
});

it.each(['yt-dlp', 'youtube-watch-page'] as const)(
  'preserves last-good %s capture on failure, clears absence, and supplies only current classifier text', async method => {
  const directory = await mkdtemp(join(tmpdir(), 'aidha-creator-refresh-'));
  directories.push(directory);
  const videoId = 'refreshnote';
  const id = `youtube-${videoId}`;
  const db = join(directory, 'graph.sqlite');
  const base = fixtureConfig();
  const config = { ...base, db, llm: { ...base.llm, cacheDir: join(directory, 'cache') },
    extensions: { profile: { taxonomy: { tags: [] } } } };
  const client = new RealYouTubeClient();
  vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Unexpected HTTP request'));
  const fetchVideo = vi.spyOn(client, 'fetchVideo');
  vi.spyOn(client, 'fetchTranscript').mockResolvedValue({ ok: true, value: {
    videoId, language: 'en', fullText: 'Measurements are recorded before comparison.',
    segments: [{ start: 0, duration: 10, text: 'Measurements are recorded before comparison.' }],
  } });
  const contexts: Array<string | undefined> = [];
  const classify = KeywordTaxonomyClassifier.prototype.classify;
  vi.spyOn(KeywordTaxonomyClassifier.prototype, 'classify').mockImplementation(function (
    this: KeywordTaxonomyClassifier, request: ClassificationRequest,
  ) {
    contexts.push(request.context.sourceSummary);
    return classify.call(this, request);
  });
  let minute = 0;
  const rawDescription = 'Guide: https://example.test/guide\r\nRepeated https://example.test/guide';
  async function refresh(description: string | undefined, acquisition?: CreatorNoteAcquisition) {
    const now = `2026-10-18T15:${String(minute++).padStart(2, '0')}:00.000Z`;
    fetchVideo.mockResolvedValue({ ok: true, value: {
      id: videoId, title: 'Fictional source', channelId: 'UC-fixture', channelName: 'Fixture author',
      duration: 10, ...(description === undefined ? {} : { description }),
      ...(acquisition ? { creatorNoteAcquisition: { ...acquisition, method } } : {}),
    } });
    const store = SQLiteStore.open(db);
    try {
      const result = await ingestYouTubeVideo({ store, client, config, llm: createFixtureLlm(),
        services: { clock: { now: () => new Date(now) } } }, videoId);
      if (!result.ok) throw result.error;
    } finally { await store.close(); }
    const reopened = SQLiteStore.open(db);
    try {
      const read = await reopened.getNode(id);
      if (!read.ok || !read.value) throw new Error('Missing reopened capture');
      return { metadata: read.value.metadata, now };
    } finally { await reopened.close(); }
  }
  const first = await refresh(rawDescription, { state: 'available' });
  expect(first.metadata['description']).toBe(rawDescription);
  expect(contexts.at(-1)).toContain(rawDescription);
  const second = await refresh(rawDescription, { state: 'available' });
  const firstCapture = first.metadata['creatorNoteCapture'];
  const secondCapture = second.metadata['creatorNoteCapture'];
  if (typeof firstCapture !== 'object' || firstCapture === null || Array.isArray(firstCapture)
    || typeof secondCapture !== 'object' || secondCapture === null || Array.isArray(secondCapture)
    || !('identitySha256' in firstCapture) || !('identitySha256' in secondCapture)
    || !('capturedAt' in secondCapture)) {
    throw new Error('Missing capture envelope');
  }
  expect(secondCapture['identitySha256']).toBe(firstCapture['identitySha256']);
  expect(secondCapture['capturedAt']).toBe(second.now);
  const failed = await refresh(undefined, { state: 'failed', reason: 'timeout' });
  expect(failed.metadata['description']).toBe(rawDescription);
  expect(failed.metadata['creatorNoteCapture']).toEqual(secondCapture);
  expect(failed.metadata['creatorNoteCaptureAttempt']).toEqual({
    schemaVersion: 1, method, state: 'failed', reason: 'timeout', attemptedAt: failed.now,
  });
  expect(contexts.at(-1)).toBe('Fictional source\nChannel: Fixture author');
  const empty = await refresh('', { state: 'empty' });
  expect(empty.metadata['description']).toBe('');
  expect(empty.metadata['creatorNoteCapture']).toMatchObject({ state: 'empty' });
  const absent = await refresh(undefined, { state: 'unavailable' });
  expect(absent.metadata['description']).toBeNull();
  expect(absent.metadata['creatorNoteCapture']).toMatchObject({ state: 'unavailable', contentSha256: null });
  const legacy = await refresh('Legacy supplied creator description');
  expect(legacy.metadata['description']).toBe('Legacy supplied creator description');
  expect(contexts.at(-1)).toContain('Legacy supplied creator description');
  expect(legacy.metadata['creatorNoteCapture']).toBeNull();
  expect(legacy.metadata['creatorNoteCaptureAttempt']).toBeNull();
  expect(globalThis.fetch).not.toHaveBeenCalled();
}, 60_000);
