import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { KeywordTaxonomyClassifier, type ClassificationRequest } from '@aidha/praecis-core';
import { runCli } from '../src/cli.js';
import { SQLiteStore } from '@aidha/graph-backend';
import { RealYouTubeClient } from '../src/client/youtube.js';
import { ingestYouTubeVideo } from '../src/ingest/runtime-ingestion.js';
import { createFixtureLlm, fixtureConfig } from './helpers/runtime-ingestion.js';

// Fictional protocol fixture; this is not an owner-approved semantic benchmark.
const videoId = 'shownotefx1';
const resourceId = `youtube-${videoId}`;
const sourceUrl = `https://www.youtube.com/watch?v=${videoId}`;
const capturedAt = '2026-10-18T15:00:00.000Z';
const description = 'Guide: https://example.test/prompt\r\n'
  + 'More: https://example.test/reference\n'
  + 'Guide again: https://example.test/prompt';
const directories: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  for (const directory of directories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

describe('creator-note acquisition through public ingestion', () => {
  it.each([false, true])('persists literal short links and truthful source identity with dedup alias=%s', async alias => {
    const directory = await mkdtemp(join(tmpdir(), 'aidha-creator-note-'));
    directories.push(directory);
    const metadata = {
      id: videoId, title: 'Fictional workshop', channel_id: 'UC-fixture',
      channel: 'Fixture author', duration: 12, description,
      webpage_url: sourceUrl, thumbnail: 'https://example.test/thumbnail.jpg',
    };
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
      if (String(input) === sourceUrl) return new Response('ytInitialPlayerResponse = '
        + JSON.stringify({ videoDetails: { videoId, shortDescription: description } }) + ';');
      expect(String(input)).toMatch(/^https:\/\/www\.youtube\.com\/oembed\?/u);
      return new Response(JSON.stringify({
        title: metadata.title, author_name: metadata.channel,
        author_url: 'https://www.youtube.com/channel/UC-fixture',
        thumbnail_url: metadata.thumbnail,
      }), { headers: { 'Content-Type': 'application/json' } });
    });
    const client = new RealYouTubeClient();
    vi.spyOn(client, 'fetchTranscript').mockResolvedValue({ ok: true, value: {
      videoId, language: 'en',
      fullText: 'The workshop labels every sample before measuring it and keeps failed readings.',
      segments: [{ start: 0, duration: 12,
        text: 'The workshop labels every sample before measuring it and keeps failed readings.' }],
    } });
    const db = join(directory, 'graph.sqlite');
    const config = fixtureConfig();
    config.db = db;
    config.llm.cacheDir = join(directory, 'cache');
    const store = SQLiteStore.open(db);
    const persistedResourceId = alias ? 'existing-fictional-alias' : resourceId;
    if (alias) {
      const seeded = await store.upsertNode('Resource', persistedResourceId, {
        label: 'Existing fictional source',
        metadata: { canonicalId: persistedResourceId, dedupKeys: [resourceId],
          sourceType: 'web', provenances: [] },
      });
      if (!seeded.ok) throw seeded.error;
    }
    try {
      const result = await ingestYouTubeVideo({
        store, client, config, llm: createFixtureLlm(),
        services: { clock: { now: () => new Date(capturedAt) } },
      }, videoId);
      if (!result.ok) throw result.error;
      expect(result.value.nodeId).toBe(persistedResourceId);
    } finally {
      await store.close();
    }

    const reopened = SQLiteStore.open(db);
    try {
      const read = await reopened.getNode(persistedResourceId);
      if (!read.ok || !read.value) throw new Error('Missing persisted fictional source');
      // The unchanged real client reaches this assertion with description absent.
      expect(read.value.metadata['description']).toBe(description);
      expect(String(read.value.metadata['description']).match(/https?:\/\/\S+/gu)).toEqual([
        'https://example.test/prompt', 'https://example.test/reference',
        'https://example.test/prompt',
      ]);
      const contentSha256 = createHash('sha256').update(description).digest('hex');
      const stableCapture = {
        schemaVersion: 1, kind: 'youtube-description',
        sourceCanonicalId: resourceId, sourceUrl,
        state: 'available', contentSha256,
      };
      const identitySha256 = createHash('sha256')
        .update(JSON.stringify(stableCapture)).digest('hex');
      expect(read.value.metadata['creatorNoteCapture']).toEqual({
        ...stableCapture, identitySha256, capturedAt,
      });
      expect(read.value.metadata['creatorNoteCaptureAttempt']).toEqual({
        schemaVersion: 1, method: 'youtube-watch-page', state: 'success', attemptedAt: capturedAt,
      });
    } finally {
      await reopened.close();
    }
    expect(fetch.mock.calls).toHaveLength(2);
  }, 60_000);
});


describe('stored creator-note attempt freshness', () => {
  it.each(['failed', 'not_configured', 'success'])('preserves stored capture state and supplies only eligible cached text after %s', async state => {
    const directory = await mkdtemp(join(tmpdir(), 'aidha-stored-creator-note-'));
    directories.push(directory);
    const db = join(directory, 'graph.sqlite');
    const config = fixtureConfig();
    config.db = db;
    config.llm.cacheDir = join(directory, 'cache');
    const client = new RealYouTubeClient();
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Unexpected HTTP request'));
    vi.spyOn(client, 'fetchVideo').mockResolvedValue({ ok: true, value: {
      id: videoId, title: 'Fictional workshop', channelId: 'UC-fixture',
      channelName: 'Fixture author', duration: 12, description,
    } });
    vi.spyOn(client, 'fetchTranscript').mockResolvedValue({ ok: true, value: {
      videoId, language: 'en', fullText: 'The workshop retains failed readings.',
      segments: [{ start: 0, duration: 12, text: 'The workshop retains failed readings.' }],
    } });
    const capture = { schemaVersion: 1, kind: 'youtube-description',
      sourceCanonicalId: resourceId, sourceUrl, state: 'available',
      capturedAt, contentSha256: createHash('sha256').update(description).digest('hex') };
    const attempt = { schemaVersion: 1, method: 'yt-dlp', state, attemptedAt: capturedAt };
    const store = SQLiteStore.open(db);
    try {
      const seeded = await ingestYouTubeVideo({ store, client, config, llm: createFixtureLlm() }, videoId);
      if (!seeded.ok) throw seeded.error;
      const read = await store.getNode(resourceId);
      if (!read.ok || !read.value) throw new Error('Missing source fixture');
      const updated = await store.upsertNode('Resource', resourceId, {
        label: read.value.label, metadata: { ...read.value.metadata,
          description, creatorNoteCapture: capture, creatorNoteCaptureAttempt: attempt },
      });
      if (!updated.ok) throw updated.error;
    } finally { await store.close(); }
    const path = join(directory, 'config.yaml');
    await writeFile(path, `config_version: 1
default_profile: fixture
profiles:
  fixture:
    db: ${JSON.stringify(db)}
    extensions:
      taxonomy:
        tags: []
    llm:
      model: ""
      cache_dir: ${JSON.stringify(join(directory, 'cli-cache'))}
`);
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
    expect(contexts.every(value => Boolean(value?.includes('https://example.test/prompt'))
      === (state === 'success'))).toBe(true);
    expect(globalThis.fetch).not.toHaveBeenCalled();
    const reopened = SQLiteStore.open(db);
    try {
      const read = await reopened.getNode(resourceId);
      if (!read.ok || !read.value) throw new Error('Missing retained source');
      expect(read.value.metadata['description']).toBe(description);
      expect(read.value.metadata['creatorNoteCapture']).toEqual(capture);
      expect(read.value.metadata['creatorNoteCaptureAttempt']).toEqual(attempt);
    } finally { await reopened.close(); }
  }, 60_000);
});
