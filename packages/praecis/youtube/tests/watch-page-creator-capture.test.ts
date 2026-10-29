import { createHash } from 'node:crypto';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { SQLiteStore } from '@aidha/graph-backend';
import {
  SourceDistillationMiner, type LlmClient,
} from '@aidha/praecis-core';
import { RealYouTubeClient } from '../src/client/youtube.js';
import { ytDlpDefaultConfig } from '../src/client/yt-dlp.js';
import { ingestYouTubeVideo } from '../src/ingest/runtime-ingestion.js';
import { fixtureConfig } from './helpers/runtime-ingestion.js';

// Fictional HTTP/protocol fixture; no live source, destination fetch or semantic benchmark.
const videoId = 'watchnotes1';
const sourceUrl = `https://www.youtube.com/watch?v=${videoId}`;
const canonicalId = `youtube-${videoId}`;
const description = 'Guide: https://example.test/watch-guide\r\n'
  + '🧭 Fictional café workflow: label each sample before sorting.\n'
  + 'Literal braces stay {unchanged}; linked content has not been inspected.';
// Bind this integration fixture to its literal UTF-8 input and documented v1 source identity.
// Dedicated capture unit vectors protect the hash algorithm itself.
const contentSha256 = createHash('sha256').update(description, 'utf8').digest('hex');
const identitySha256 = createHash('sha256').update(JSON.stringify({
  schemaVersion: 1, kind: 'youtube-description', sourceCanonicalId: canonicalId, sourceUrl,
  state: 'available', contentSha256,
})).digest('hex');
const transcript = 'The workshop labels each sample before placing it in a separate clean tray. '
  + 'The procedure applies only to this fictional training assembly.';
const capturedAt = '2026-10-19T12:00:00.000Z';
const clock = { now: () => new Date(capturedAt) };

it('persists exact watch-page creator capture through public ingestion and SQLite reopen', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'aidha-watch-creator-capture-'));
  const executable = join(directory, 'unexpected-description-process');
  const processMarker = join(directory, 'description-process-used');
  const db = join(directory, 'graph.sqlite');
  let store = SQLiteStore.open(db);
  try {
    // Capture must use the supplied watch response, never an optional description subprocess.
    // This sentinel lets normal ingestion finish if an unintended process route is attempted.
    await writeFile(executable, '#!/usr/bin/python3\nfrom pathlib import Path\nimport json\n'
      + `Path(${JSON.stringify(processMarker)}).write_text("unexpected description process")\n`
      + `print(json.dumps({"id": ${JSON.stringify(videoId)}, "description": None}))\n`);
    await chmod(executable, 0o700);
    const page = '<html><script>var ytInitialPlayerResponse = '
      + JSON.stringify({ videoDetails: { videoId, title: 'Ignored watch title', author: 'Ignored page author',
        shortDescription: description } }) + ';</script></html>';
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = new URL(String(input));
      if (url.origin === 'https://www.youtube.com' && url.pathname === '/oembed') {
        expect(url.searchParams.get('url')).toBe(sourceUrl);
        return new Response(JSON.stringify({ title: 'Fictional workshop', author_name: 'oEmbed publisher',
          author_url: 'https://www.youtube.com/channel/UC-fixture',
          thumbnail_url: 'https://example.test/oembed.jpg' }));
      }
      if (url.toString() === sourceUrl) {
        expect(init?.redirect).toBe('manual');
        expect(init?.credentials).toBe('omit');
        expect(new Headers(init?.headers).has('Cookie')).toBe(false);
        expect(new Headers(init?.headers).has('Authorization')).toBe(false);
        expect(init?.signal).toBeInstanceOf(AbortSignal);
        return new Response(page, { headers: { 'content-type': 'text/html; charset=utf-8' } });
      }
      throw new Error(`Unexpected HTTP request: ${url.toString()}`);
    });
    const client = new RealYouTubeClient({ cookie: 'must-not-be-sent', debugTranscript: false }, {
      ...ytDlpDefaultConfig(), bin: executable, timeoutMs: 5000,
    });
    // Transcript and mining are controlled; fetchVideo, ingestion and persistence are production paths.
    vi.spyOn(client, 'fetchTranscript').mockResolvedValue({ ok: true, value: {
      videoId, language: 'en', fullText: transcript,
      segments: [{ start: 0, duration: 12, text: transcript }],
    } });
    let miningCalls = 0;
    const minerLlm: LlmClient = { async generate(request) {
      miningCalls += 1;
      if (miningCalls === 1) {
        const encoded = request.user.split('TRANSCRIPT_EXCERPTS:\n')[1];
        if (!encoded) throw new Error('Actual mining request omitted transcript excerpts');
        const excerpts = JSON.parse(encoded) as Array<{ id: string }>;
        const excerpt = excerpts[0];
        if (!excerpt) throw new Error('Actual mining request has no excerpt');
        return { ok: true, value: JSON.stringify({ schemaVersion: 1,
          sourceType: 'tutorial', sourceCoherence: 'single_topic', theses: [], units: [{
            id: 'u1', kind: 'fact', text: 'The workshop labels each sample before placing it in a separate clean tray.',
            stance: 'asserted', importance: 'core', evidence: [{ excerptId: excerpt.id,
              quote: 'labels each sample before placing it in a separate clean tray' }],
          }] }) };
      }
      if (miningCalls !== 2) throw new Error('Unexpected extra distillation request');
      return { ok: true, value: JSON.stringify({ verdicts: [{ unitId: 'u1', verdict: 'grounded' }] }) };
    } };
    const config = fixtureConfig();
    config.db = db;
    config.llm.cacheDir = join(directory, 'cache');
    const ingested = await ingestYouTubeVideo({ store, client, config, llm: minerLlm,
      services: { clock, miner: new SourceDistillationMiner() } }, videoId);
    if (!ingested.ok) throw ingested.error;
    expect(miningCalls).toBe(2);
    expect(ingested.value.nodeId).toBe(canonicalId);
    expect(ingested.value.report.claimIds.length).toBeGreaterThan(0);
    await store.close();
    store = SQLiteStore.open(db);
    const resource = await store.getNode(canonicalId);
    if (!resource.ok || !resource.value) throw new Error('Missing reopened production Resource');
    expect(resource.value.label).toBe('Fictional workshop');
    expect(resource.value.metadata['channelName']).toBe('oEmbed publisher');
    // Intended RED on public main: real ingestion, two mining calls and SQLite reopen have succeeded.
    expect(resource.value.metadata['description'],
      'Reopened production Resource must retain the literal watch-page description').toBe(description);
    expect(resource.value.metadata['creatorNoteCapture']).toEqual({
      schemaVersion: 1, kind: 'youtube-description', sourceCanonicalId: canonicalId, sourceUrl,
      state: 'available', contentSha256, identitySha256, capturedAt,
    });
    expect(resource.value.metadata['creatorNoteCaptureAttempt']).toEqual({
      schemaVersion: 1, method: 'youtube-watch-page', state: 'success', attemptedAt: capturedAt,
    });
    expect(resource.value.metadata['sourceOwnedMetadataGroups']).toEqual({
      schemaVersion: 1,
      groups: { 'youtube-creator-notes-v1': { canonicalId,
        fields: ['creatorNoteCapture', 'creatorNoteCaptureAttempt', 'description'] } },
    });
    const requestedUrls = fetch.mock.calls.map(([input]) => String(input));
    expect(requestedUrls).toHaveLength(2);
    expect(requestedUrls.filter(url => url === sourceUrl)).toHaveLength(1);
    expect(requestedUrls.filter(url => new URL(url).pathname === '/oembed')).toHaveLength(1);
    await expect(readFile(processMarker, 'utf8'), 'Optional description subprocess must not run')
      .rejects.toMatchObject({ code: 'ENOENT' });
  } finally {
    vi.restoreAllMocks();
    await store.close();
    await rm(directory, { recursive: true, force: true });
  }
});
