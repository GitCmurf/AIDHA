// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 Colin Farmer (GitCmurf)
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RealYouTubeClient } from '../src/client/youtube.js';
import { YouTubeIngestor } from '../src/ingest/youtube-ingestor.js';
import { resolveConfig } from '@aidha/config';
import { fetchTranscriptWithYtDlp } from '../src/client/yt-dlp.js';

// Every HTTP request is mocked; this suite never selects an installed native fallback.
vi.mock('../src/client/yt-dlp.js', async importOriginal => ({
  ...await importOriginal<typeof import('../src/client/yt-dlp.js')>(),
  fetchTranscriptWithYtDlp: vi.fn(),
  fetchPlaylistWithYtDlp: vi.fn(),
}));

beforeEach(() => {
  vi.mocked(fetchTranscriptWithYtDlp).mockReset().mockResolvedValue({
    ok: false, error: new Error('Fictional yt-dlp fallback failure'),
  });
});
afterEach(() => { vi.restoreAllMocks(); });

const attemptedUrl = (input: Parameters<typeof fetch>[0]): string => {
  return typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
};

const aggregateCause = (error: Error): Error[] => {
  expect(error.cause).toBeInstanceOf(AggregateError);
  if (!(error.cause instanceof AggregateError)) throw new Error('Expected grouped diagnostic causes');
  return error.cause.errors as Error[];
};

/** Keep the independent creator-note request successful when exercising oEmbed errors. */
const mockMetadataFailure = (original: Error) => {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(input => {
    const url = new URL(attemptedUrl(input));
    if (url.pathname === '/watch') {
      return Promise.resolve(new Response(`ytInitialPlayerResponse = ${JSON.stringify({
        videoDetails: { videoId: url.searchParams.get('v') },
      })};`));
    }
    if (url.pathname === '/oembed') return Promise.reject(original);
    return Promise.reject(new Error('Unexpected offline metadata request'));
  });
};

const fictionalApiKey = 'fictional-offline-key'; // pragma: allowlist secret - fictional offline fixture
const captionUrl = 'https://example.test/captions?token=fictional-query-value&fmt=vtt';
const htmlWithTrack = (): Response => {
  return new Response(`ytInitialPlayerResponse = ${JSON.stringify({
    captions: { playerCaptionsTracklistRenderer: { captionTracks: [
      { baseUrl: captionUrl, languageCode: 'en', name: { simpleText: 'English' } },
    ] } },
  })};`);
};

describe('YouTube client network diagnostics', () => {
  it('labels oEmbed failure and makes its immediate DNS cause readable while retaining the original Error', async () => {
    const cause = Object.assign(new Error('Fictional DNS lookup failed'), { code: 'EAI_AGAIN' });
    const original = new TypeError('fetch failed', { cause });
    const fetch = mockMetadataFailure(original);
    const result = await new RealYouTubeClient({ debugTranscript: false }).fetchVideo('video-one');
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('Expected acquisition failure');
    expect(result.error.message).toContain('youtube oEmbed fetch failed for video-one');
    expect(result.error.message).toContain('Fictional DNS lookup failed');
    expect(result.error.message).toContain('EAI_AGAIN');
    expect(result.error.cause).toBe(original);
    expect(original.cause).toBe(cause);
    expect(fetch.mock.calls.map(([input]) => new URL(attemptedUrl(input)).pathname))
      .toEqual(['/watch', '/oembed']);
  });

  it('preserves real metadata diagnostics through acquisition and stops before transcript fetching', async () => {
    const original = new TypeError('fetch failed', { cause: { code: 'EAI_AGAIN', message: 'Fictional DNS failure' } });
    const fetch = mockMetadataFailure(original);
    const client = new RealYouTubeClient({ debugTranscript: false });
    const metadata = vi.spyOn(client, 'fetchVideo');
    const transcript = vi.spyOn(client, 'fetchTranscript');
    const result = await new YouTubeIngestor(client).acquire({ ref: 'video-one' }, {
      config: resolveConfig({ env: {} }),
      clock: { now: () => new Date('2026-10-18T12:00:00.000Z') },
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('Expected metadata acquisition failure');
    const upstream = await metadata.mock.results[0]?.value;
    if (!upstream || upstream.ok) throw new Error('Expected failed real-client metadata Result');
    expect(result.error).toBe(upstream.error);
    expect(result.error.message).toContain('youtube oEmbed fetch failed for video-one');
    expect(result.error.message).toContain('Fictional DNS failure');
    expect(result.error.cause).toBe(original);
    expect(fetch.mock.calls.map(([input]) => new URL(attemptedUrl(input)).pathname))
      .toEqual(['/watch', '/oembed']);
    expect(transcript).not.toHaveBeenCalled();
    expect(fetchTranscriptWithYtDlp).not.toHaveBeenCalled();
  });

  it('cancels and settles the concurrent creator-note request before returning an oEmbed error', async () => {
    const original = new Error('Fictional metadata failure');
    const watch: {
      signal?: AbortSignal | null;
      release?: () => void;
      aborted?: () => void;
    } = {};
    const abortObserved = new Promise<void>(resolve => { watch.aborted = resolve; });
    vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
      const url = new URL(attemptedUrl(input));
      if (url.pathname === '/oembed') return Promise.reject(original);
      if (url.pathname !== '/watch') return Promise.reject(new Error('Unexpected offline metadata request'));
      watch.signal = init?.signal;
      return new Promise<Response>((_resolve, reject) => {
        watch.release = () => reject(new Error('Fictional cancelled watch request'));
        init?.signal?.addEventListener('abort', () => watch.aborted?.(), { once: true });
      });
    });
    const pending = new RealYouTubeClient({ debugTranscript: false }).fetchVideo('video-one');
    let metadataReturned = false;
    const completed = pending.then(result => { metadataReturned = true; return result; });
    try {
      await abortObserved;
      // Drain already queued work while the watch response remains explicitly gated.
      await new Promise<void>(resolve => { setImmediate(resolve); });
      expect(watch.signal?.aborted).toBe(true);
      expect(metadataReturned).toBe(false);
    } finally {
      watch.release?.();
    }
    const result = await completed;
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('Expected metadata failure');
    expect(result.error.cause).toBe(original);
    expect(fetchTranscriptWithYtDlp).not.toHaveBeenCalled();
  });

  it('keeps successful metadata when its optional creator-note request fails', async () => {
    const original = new Error('Fictional optional watch failure');
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(input => {
      const url = new URL(attemptedUrl(input));
      if (url.pathname === '/watch') return Promise.reject(original);
      if (url.pathname !== '/oembed') return Promise.reject(new Error('Unexpected offline metadata request'));
      return Promise.resolve(new Response(JSON.stringify({
        title: 'Fictional title', author_name: 'Fictional channel',
      })));
    });
    const result = await new RealYouTubeClient({ debugTranscript: false }).fetchVideo('video-one');
    expect(result.ok).toBe(true);
    if (!result.ok) throw result.error;
    expect(result.value.title).toBe('Fictional title');
    expect(result.value.creatorNoteAcquisition).toEqual({
      state: 'failed', reason: 'execution', method: 'youtube-watch-page',
    });
    expect(fetch.mock.calls.map(([input]) => new URL(attemptedUrl(input)).pathname))
      .toEqual(['/watch', '/oembed']);
    expect(fetchTranscriptWithYtDlp).not.toHaveBeenCalled();
  });

  it('formats one plain-object cause without losing its original Error', async () => {
    const cause = { code: 'ECONNRESET', message: 'Fictional connection reset' };
    const original = new TypeError('fetch failed', { cause });
    mockMetadataFailure(original);
    const result = await new RealYouTubeClient({ debugTranscript: false }).fetchVideo('video-one');
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('Expected acquisition failure');
    expect(result.error.message).toContain('ECONNRESET');
    expect(result.error.message).toContain('Fictional connection reset');
    expect(result.error.cause).toBe(original);
  });

  it('bounds cause inspection to one level even when the original cause is cyclic', async () => {
    const original = new Error('Fictional cyclic failure');
    original.cause = original;
    mockMetadataFailure(original);
    const result = await new RealYouTubeClient({ debugTranscript: false }).fetchVideo('video-one');
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('Expected acquisition failure');
    expect(result.error.message).toContain('youtube oEmbed fetch failed for video-one');
    expect(result.error.message.length).toBeLessThan(200);
    expect(result.error.cause).toBe(original);
  });

  it('keeps successful metadata and HTTP failure outcomes unchanged', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(input => {
      const url = new URL(attemptedUrl(input));
      if (url.pathname === '/watch') {
        return Promise.resolve(new Response(`ytInitialPlayerResponse = ${JSON.stringify({
          videoDetails: { videoId: url.searchParams.get('v') },
        })};`));
      }
      if (url.pathname !== '/oembed') return Promise.reject(new Error('Unexpected offline metadata request'));
      return Promise.resolve(new Response(url.searchParams.get('url')?.includes('video-one')
        ? JSON.stringify({
          title: 'Fictional title', author_name: 'Fictional channel', thumbnail_url: 'https://example.test/image',
        }) : '', { status: url.searchParams.get('url')?.includes('video-one') ? 200 : 503 }));
    });
    const client = new RealYouTubeClient({ debugTranscript: false });
    const success = await client.fetchVideo('video-one');
    expect(success.ok).toBe(true);
    if (!success.ok) throw success.error;
    expect(success.value.title).toBe('Fictional title');
    const failure = await client.fetchVideo('video-two');
    expect(failure.ok).toBe(false);
    if (failure.ok) throw new Error('Expected HTTP failure');
    expect(failure.error.message).toBe('oEmbed failed: 503');
    expect(fetch.mock.calls.map(([input]) => new URL(attemptedUrl(input)).pathname))
      .toEqual(['/watch', '/oembed', '/watch', '/oembed']);
  });
  it('preserves labelled discovery and coarse fallback causes in attempted order when every route fails', async () => {
    const inner = new TypeError('Fictional player request failed', { cause: { code: 'EPLAYER' } });
    const html = new Error('Fictional HTML request failed');
    const timed = new Error('Fictional timedtext request failed');
    const getTranscript = new Error('Fictional get_transcript page failed');
    const native = new Error('Fictional yt-dlp fallback failed');
    vi.mocked(fetchTranscriptWithYtDlp).mockResolvedValue({ ok: false, error: native });
    const attempts: string[] = [];
    let watchRequests = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(input => Promise.resolve().then(() => {
      const url = attemptedUrl(input);
      attempts.push(url);
      if (url.includes('/youtubei/v1/player')) throw inner;
      if (url.includes('/api/timedtext?type=list')) throw timed;
      if (url.includes('/watch?')) throw ++watchRequests === 1 ? html : getTranscript;
      throw new Error('Unexpected offline request');
    }));
    const result = await new RealYouTubeClient({ debugTranscript: false, innertubeApiKey: fictionalApiKey })
      .fetchTranscript('video-one');
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('Expected transcript failure');
    for (const label of ['Innertube caption-track', 'video-page caption-track', 'timedtext track-list', 'get_transcript']) {
      expect(result.error.message).toContain(label);
    }
    expect(result.error.message).toContain('Fictional yt-dlp fallback failed');
    expect(result.error.message).toContain('EPLAYER');
    const phases = aggregateCause(result.error);
    expect(phases).toHaveLength(3);
    const tracks = phases[0];
    const get = phases[1];
    if (!tracks || !get) throw new Error('Expected discovery and get_transcript phase failures');
    const discovery = aggregateCause(tracks);
    expect(discovery).toHaveLength(3);
    expect(discovery[0]?.cause).toBe(inner);
    expect(discovery[1]?.cause).toBe(html);
    expect(discovery[2]?.cause).toBe(timed);
    expect(get.cause).toBe(getTranscript);
    expect(phases[2]).toBe(native);
    expect(attempts.map(url => new URL(url).pathname)).toEqual([
      '/youtubei/v1/player', '/watch', '/api/timedtext', '/watch',
    ]);
    expect(fetchTranscriptWithYtDlp).toHaveBeenCalledTimes(1);
    expect(result.error.message).not.toContain(fictionalApiKey);
  });

  it('deduplicates identical coarse-phase messages while retaining each original phase error', async () => {
    const native = new Error('Video page failed: 503');
    vi.spyOn(globalThis, 'fetch').mockImplementation(() => Promise.resolve(new Response('', { status: 503 })));
    vi.mocked(fetchTranscriptWithYtDlp).mockResolvedValue({ ok: false, error: native });
    const result = await new RealYouTubeClient({ debugTranscript: false }).fetchTranscript('video-one');
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('Expected transcript failure');
    // One occurrence belongs to nested discovery; one represents the identical get/native messages.
    expect(result.error.message.match(/Video page failed: 503/g)).toHaveLength(2);
    const phases = aggregateCause(result.error);
    expect(phases).toHaveLength(3);
    expect(phases[2]).toBe(native);
    expect(phases[1]).not.toBe(native);
  });

  it('still succeeds from yt-dlp after failed HTTP routes without changing their order', async () => {
    const attempts: string[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(input => Promise.resolve().then(() => {
      attempts.push(new URL(attemptedUrl(input)).pathname);
      throw new Error('Fictional HTTP failure');
    }));
    vi.mocked(fetchTranscriptWithYtDlp).mockResolvedValue({ ok: true, value: {
      videoId: 'video-one', language: 'en', fullText: 'Recovered fictional caption',
      segments: [{ start: 0, duration: 1, text: 'Recovered fictional caption' }],
    } });
    const result = await new RealYouTubeClient({ debugTranscript: false, innertubeApiKey: fictionalApiKey })
      .fetchTranscript('video-one');
    expect(result.ok).toBe(true);
    if (!result.ok) throw result.error;
    expect(result.value.fullText).toBe('Recovered fictional caption');
    expect(attempts).toEqual(['/youtubei/v1/player', '/watch', '/api/timedtext', '/watch']);
    expect(fetchTranscriptWithYtDlp).toHaveBeenCalledTimes(1);
  });

  it('still accepts HTML caption discovery after an Innertube failure and stops on a usable segment', async () => {
    const attempts: string[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(input => Promise.resolve().then(() => {
      const url = attemptedUrl(input);
      attempts.push(new URL(url).pathname);
      if (url.includes('/youtubei/v1/player')) throw new Error('Fictional player failure');
      if (url.includes('/watch?')) return htmlWithTrack();
      if (url.startsWith('https://example.test/captions')) {
        return new Response('WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nFictional caption\n');
      }
      throw new Error('Unexpected offline request');
    }));
    const result = await new RealYouTubeClient({ debugTranscript: false, innertubeApiKey: fictionalApiKey })
      .fetchTranscript('video-one');
    expect(result.ok).toBe(true);
    if (!result.ok) throw result.error;
    expect(result.value.fullText).toBe('Fictional caption');
    expect(attempts).toEqual(['/youtubei/v1/player', '/watch', '/captions']);
    expect(fetchTranscriptWithYtDlp).not.toHaveBeenCalled();
  });

  it('labels a segment fetch failure without adding URLs, credentials or a new fallback attempt', async () => {
    const original = new TypeError('fetch failed', { cause: { code: 'ECONNRESET', message: 'Fictional segment reset' } });
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(input => Promise.resolve().then(() => {
      const url = attemptedUrl(input);
      if (url.includes('/watch?')) return htmlWithTrack();
      if (url.startsWith('https://example.test/captions')) throw original;
      throw new Error('Unexpected offline request');
    }));
    const result = await new RealYouTubeClient({ debugTranscript: false, cookie: 'fictional-session-cookie' })
      .fetchTranscript('video-one');
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('Expected segment failure');
    expect(result.error.message).toContain('youtube transcript fetch failed for video-one');
    expect(result.error.message).toContain('youtube transcript segment fetch failed for video-one');
    expect(result.error.message).toContain('ECONNRESET');
    expect(result.error.message).toContain('Fictional segment reset');
    expect(result.error.cause).toBeInstanceOf(Error);
    if (!(result.error.cause instanceof Error)) throw new Error('Expected segment wrapper');
    expect(result.error.cause.cause).toBe(original);
    expect(result.error.message).not.toContain('example.test');
    expect(result.error.message).not.toContain('fictional-query-value');
    expect(result.error.message).not.toContain('fictional-session-cookie');
    expect(fetch.mock.calls.map(([input]) => new URL(attemptedUrl(input)).pathname))
      .toEqual(['/watch', '/captions']);
    expect(fetchTranscriptWithYtDlp).not.toHaveBeenCalled();
  });

  it('retains the segment phase when reading a returned caption response body fails', async () => {
    const original = new TypeError('Fictional truncated caption body', { cause: { code: 'ECONNRESET' } });
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(input => Promise.resolve().then(() => {
      const url = attemptedUrl(input);
      if (url.includes('/watch?')) return htmlWithTrack();
      if (url.startsWith('https://example.test/captions')) {
        return new Response(new ReadableStream<Uint8Array>({ start(controller) { controller.error(original); } }));
      }
      throw new Error('Unexpected offline request');
    }));
    const result = await new RealYouTubeClient({ debugTranscript: false }).fetchTranscript('video-one');
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('Expected body-read failure');
    expect(result.error.message).toContain('youtube transcript segment fetch failed for video-one');
    expect(result.error.message).toContain('Fictional truncated caption body');
    expect(result.error.message).toContain('ECONNRESET');
    if (!(result.error.cause instanceof Error)) throw new Error('Expected segment diagnostic wrapper');
    expect(result.error.cause.cause).toBe(original);
    expect(fetch.mock.calls.map(([input]) => new URL(attemptedUrl(input)).pathname))
      .toEqual(['/watch', '/captions']);
    expect(fetchTranscriptWithYtDlp).not.toHaveBeenCalled();
  });

  it('labels the outer metadata failure boundary without changing malformed-response failure', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(input => Promise.resolve(
      new Response(new URL(attemptedUrl(input)).pathname === '/oembed' ? 'null' :
        'ytInitialPlayerResponse = {"videoDetails":{"videoId":"video-one"}};'),
    ));
    const result = await new RealYouTubeClient({ debugTranscript: false }).fetchVideo('video-one');
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('Expected malformed metadata failure');
    expect(result.error.message).toContain('youtube video metadata fetch failed for video-one');
    expect(result.error.cause).toBeInstanceOf(TypeError);
  });

});
