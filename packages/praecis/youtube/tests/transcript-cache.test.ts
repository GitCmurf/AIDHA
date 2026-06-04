import { describe, expect, it } from 'vitest';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readTranscriptCache, writeTranscriptCache } from '../src/client/transcript-cache.js';
import { RealYouTubeClient } from '../src/client/youtube.js';

const transcript = {
  videoId: 'cache-video',
  language: 'en',
  segments: [{ start: 0, duration: 5, text: 'Cached transcript text.' }],
  fullText: 'Cached transcript text.',
};

describe('transcript cache', () => {
  it('round-trips normalized transcript JSON without YouTube acquisition artifacts', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'aidha-transcript-cache-'));
    try {
      await writeTranscriptCache({ enabled: true, dir }, transcript, '2026-06-04T12:00:00.000Z');

      const cached = await readTranscriptCache({ enabled: true, dir }, transcript.videoId);
      expect(cached).toEqual(transcript);

      const files = await readdir(dir);
      expect(files).toHaveLength(1);
      const raw = await readFile(join(dir, files[0]!), 'utf8');
      expect(raw).toContain('"schemaVersion": 1');
      expect(raw).toContain('"cacheKey": "youtube:cache-video:language=en:schema=v1"');
      expect(raw).not.toMatch(/signature|expire|cookies|baseUrl|youtube\.com\/api\/timedtext/i);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('ignores refresh requests and malformed cache payloads', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'aidha-transcript-cache-'));
    try {
      await writeTranscriptCache({ enabled: true, dir }, transcript);
      expect(await readTranscriptCache({ enabled: true, dir, refresh: true }, transcript.videoId)).toBeNull();

      const [file] = await readdir(dir);
      await writeFile(join(dir, file!), '{"schemaVersion":1,"videoId":"cache-video","transcript":{"videoId":""}}\n');
      expect(await readTranscriptCache({ enabled: true, dir }, transcript.videoId)).toBeNull();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('lets the real client satisfy transcript requests from cache before network acquisition', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'aidha-transcript-cache-'));
    try {
      await writeTranscriptCache({ enabled: true, dir }, transcript);
      const client = new RealYouTubeClient({
        debugTranscript: false,
        transcriptCache: { enabled: true, dir },
      });

      const result = await client.fetchTranscript(transcript.videoId);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toEqual(transcript);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
