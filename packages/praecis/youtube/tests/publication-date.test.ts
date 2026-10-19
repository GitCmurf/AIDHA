import { afterEach, describe, expect, it, vi } from 'vitest';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SQLiteStore } from '@aidha/graph-backend';
import { RealYouTubeClient } from '../src/client/youtube.js';
import { Video } from '../src/schema/video.js';
import { ingestYouTubeVideo } from '../src/ingest/runtime-ingestion.js';
import { runCli } from '../src/cli.js';
import { createFixtureLlm, fixtureConfig } from './helpers/runtime-ingestion.js';

const videoId = 'datefixture';
const knownPublication = '2025-01-02T03:04:05.000Z';
const capturedAt = '2026-10-18T12:00:00.000Z';
const clock = { now: () => new Date(capturedAt) };
const directories: string[] = [];
const videoMetadata = {
  id: videoId, title: 'Fictional workshop', channelId: 'UC-fixture',
  channelName: 'Fixture author', duration: 0,
};

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true });
});

function realClient() {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
    expect(String(input)).toMatch(/^https:\/\/www\.youtube\.com\/oembed\?/u);
    return new Response(JSON.stringify({
      title: videoMetadata.title, author_name: videoMetadata.channelName,
      author_url: 'https://www.youtube.com/channel/UC-fixture',
      thumbnail_url: 'https://example.test/thumbnail.jpg',
    }), { headers: { 'Content-Type': 'application/json' } });
  });
  const client = new RealYouTubeClient();
  vi.spyOn(client, 'fetchTranscript').mockResolvedValue({ ok: true, value: {
    videoId, language: 'en',
    fullText: 'The workshop labels each sample before recording measurements and retains failed readings.',
    segments: [{ start: 0, duration: 12,
      text: 'The workshop labels each sample before recording measurements and retains failed readings.' }],
  } });
  return client;
}

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'aidha-publication-date-'));
  directories.push(directory);
  const db = join(directory, 'graph.sqlite');
  const config = fixtureConfig();
  config.db = db;
  config.llm.cacheDir = join(directory, 'cache');
  return { directory, db, config };
}

describe('YouTube publication dates', () => {
  it('accepts an unknown date while rejecting malformed supplied dates', () => {
    expect(Video.safeParse(videoMetadata).success).toBe(true);
    expect(Video.safeParse({ ...videoMetadata, publishedAt: knownPublication }).success).toBe(true);
    expect(Video.safeParse({ ...videoMetadata, publishedAt: 'not-a-date' }).success).toBe(false);
  });

  it('does not invent a publication date from an oEmbed response', async () => {
    const result = await realClient().fetchVideo(videoId);
    expect(result.ok).toBe(true);
    if (!result.ok) throw result.error;
    expect(result.value.publishedAt).toBeUndefined();
    expect(result.value.title).toBe(videoMetadata.title);
  });

  it('persists unknown separately from ingestion time and clears stale dates on re-acquisition', async () => {
    const f = await fixture();
    const client = realClient();
    vi.spyOn(client, 'fetchVideo').mockResolvedValueOnce({ ok: true,
      value: { ...videoMetadata, publishedAt: knownPublication } });
    const store = SQLiteStore.open(f.db);
    try {
      const services = { store, client, config: f.config, llm: createFixtureLlm(), services: { clock } };
      const first = await ingestYouTubeVideo(services, videoId);
      if (!first.ok) throw first.error;
      const known = await store.getNode(first.value.nodeId);
      expect(known.ok && known.value?.metadata['publishedAt']).toBe(knownPublication);
      const refreshed = await ingestYouTubeVideo(services, videoId);
      if (!refreshed.ok) throw refreshed.error;
    } finally { await store.close(); }
    const reopened = SQLiteStore.open(f.db);
    try {
      const saved = await reopened.getNode(`youtube-${videoId}`);
      if (!saved.ok || !saved.value) throw new Error('Missing persisted source');
      expect(saved.value.metadata['publishedAt']).toBeNull();
      expect(saved.value.metadata['provenances']).toEqual(expect.arrayContaining([
        expect.objectContaining({ ingestedAt: capturedAt }),
      ]));
    } finally { await reopened.close(); }
  }, 60_000);

  it('keeps missing stored publication dates unknown through the actual extraction CLI', async () => {
    const f = await fixture();
    const client = realClient();
    const store = SQLiteStore.open(f.db);
    try {
      const seeded = await ingestYouTubeVideo({ store, client, config: f.config,
        llm: createFixtureLlm(), services: { clock } }, videoId);
      if (!seeded.ok) throw seeded.error;
      const read = await store.getNode(seeded.value.nodeId);
      if (!read.ok || !read.value) throw new Error('Missing source fixture');
      const metadata = { ...read.value.metadata };
      delete metadata['publishedAt'];
      const updated = await store.upsertNode('Resource', read.value.id, { label: read.value.label, metadata });
      if (!updated.ok) throw updated.error;
      const missingDate = await store.getNode(read.value.id);
      expect(missingDate.ok && missingDate.value?.metadata['publishedAt']).toBeUndefined();
    } finally { await store.close(); }
    const path = join(f.directory, 'config.yaml');
    await writeFile(path, `config_version: 1\ndefault_profile: fixture\nprofiles:\n  fixture:\n    db: ${JSON.stringify(f.db)}\n    llm:\n      model: ""\n      cache_dir: ${JSON.stringify(join(f.directory, 'cli-cache'))}\n`);
    await chmod(path, 0o600);
    vi.stubEnv('AIDHA_CONFIG', undefined);
    const callsBeforeCli = vi.mocked(globalThis.fetch).mock.calls.length;
    vi.spyOn(console, 'log').mockImplementation(() => {});
    expect(await runCli(['extract', 'claims', videoId, '--config', path, '--mock'])).toBe(0);
    expect(vi.mocked(globalThis.fetch).mock.calls).toHaveLength(callsBeforeCli);
    const reopened = SQLiteStore.open(f.db);
    try {
      const read = await reopened.getNode(`youtube-${videoId}`);
      if (!read.ok || !read.value) throw new Error('Missing refreshed source');
      expect(read.value.metadata['publishedAt']).toBeNull();
    } finally { await reopened.close(); }
  }, 60_000);
});
