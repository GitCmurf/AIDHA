import { afterEach, expect, it, vi } from 'vitest';
import { RealYouTubeClient } from '../src/client/youtube.js';

const videoId = 'watchnotes1';
const sourceUrl = `https://www.youtube.com/watch?v=${videoId}`;
const basics = { title: 'oEmbed title', author_name: 'oEmbed publisher',
  author_url: 'https://www.youtube.com/channel/UC-fixture', thumbnail_url: 'https://example.test/thumb.jpg' };
const text = '🧭 Literal café notes\r\nGuide: https://example.test/guide';
const player = (description: unknown = text) => ({ videoDetails: { videoId, shortDescription: description } });
const page = (value: unknown) => `<script>var ytInitialPlayerResponse = ${JSON.stringify(value)};</script>`;

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

function fixture(watch: (init?: RequestInit) => Promise<Response> | Response,
  oembed: () => Promise<Response> | Response = () => new Response(JSON.stringify(basics))) {
  const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname === '/oembed') return oembed();
    expect(url.toString()).toBe(sourceUrl);
    expect(init?.redirect).toBe('manual');
    expect(init?.credentials).toBe('omit');
    const headers = new Headers(init?.headers);
    expect(headers.has('Cookie')).toBe(false);
    expect(headers.has('Authorization')).toBe(false);
    return watch(init);
  });
  const client = new RealYouTubeClient({ cookie: 'private-caption-cookie', debugTranscript: false });
  return { client, fetch };
}

it.each([
  ['literal', page(player()), text],
  ['empty', page(player('')), ''],
  ['missing', page({ videoDetails: { videoId } }), undefined],
  ['null', page(player(null)), undefined],
  ['immediate JSON.parse', `ytInitialPlayerResponse = JSON.parse(${JSON.stringify(JSON.stringify(player()))});`, text],
  ['literal with later same-ID JSON.parse decoy', page(player())
    + `const unrelated = JSON.parse(${JSON.stringify(JSON.stringify(player('Wrong later text')))});`, text],
])('preserves %s creator state while oEmbed stays authoritative', async (_label, html, expected) => {
  const { client } = fixture(() => new Response(html));
  const result = await client.fetchVideo(videoId);
  if (!result.ok) throw result.error;
  expect(result.value.description).toBe(expected);
  expect(result.value.creatorNoteAcquisition).toEqual({ method: 'youtube-watch-page',
    state: expected === undefined ? 'unavailable' : expected === '' ? 'empty' : 'available' });
  expect(result.value.title).toBe(basics.title);
  expect(result.value.channelName).toBe(basics.author_name);
  expect(result.value.thumbnailUrl).toBe(basics.thumbnail_url);
  expect(result.value.publishedAt).toBeUndefined();
});

it.each([
  ['missing player / consent page', '<html>Consent is required</html>', 'invalid-data'],
  ['malformed player', 'ytInitialPlayerResponse = { broken', 'invalid-data'],
  ['nonobject player followed by unrelated object', `ytInitialPlayerResponse = null; const later = ${JSON.stringify(player())}`, 'invalid-data'],
  ['missing RHS followed by unrelated object', `ytInitialPlayerResponse = ; const later = ${JSON.stringify(player())}`, 'invalid-data'],
  ['nonstring description', page(player(12)), 'invalid-data'],
  ['wrong video', page({ videoDetails: { videoId: 'different-id', shortDescription: text } }), 'identity-mismatch'],
  ['missing video ID', page({ videoDetails: { shortDescription: text } }), 'identity-mismatch'],
  ['array player', page([player()]), 'invalid-data'],
])('fails optional %s acquisition without labelling it unavailable', async (_label, html, reason) => {
  const { client } = fixture(() => new Response(html));
  const result = await client.fetchVideo(videoId);
  if (!result.ok) throw result.error;
  expect(result.value.description).toBeUndefined();
  expect(result.value.title).toBe(basics.title);
  expect(result.value.creatorNoteAcquisition).toEqual({ state: 'failed', method: 'youtube-watch-page', reason });
});

it.each([302, 403, 500])('cancels the discarded HTTP %s body without following a redirect', async status => {
  const cancel = vi.fn();
  const body = new ReadableStream<Uint8Array>({ cancel });
  const { client, fetch } = fixture(() => new Response(body, { status, headers: { location: 'https://example.test/redirect' } }));
  const result = await client.fetchVideo(videoId);
  if (!result.ok) throw result.error;
  expect(result.value.creatorNoteAcquisition).toEqual({ state: 'failed', method: 'youtube-watch-page', reason: 'execution' });
  expect(cancel).toHaveBeenCalledOnce();
  expect(fetch.mock.calls).toHaveLength(2);
});

it.each([undefined, '1'])('counts inclusive decoded-byte cap across chunks with Content-Length=%s', async contentLength => {
  const limit = 2 * 1024 * 1024;
  const encoded = new TextEncoder().encode(page(player()));
  const split = new TextEncoder().encode('<script>var ytInitialPlayerResponse = {"videoDetails":{"videoId":"watchnotes1","shortDescription":"').length + 1;
  for (const extra of [0, 1]) {
    const bytes = new Uint8Array(limit + extra).fill(32);
    bytes.set(encoded);
    const chunks = [bytes.subarray(0, split), bytes.subarray(split, limit - 1), bytes.subarray(limit - 1)];
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({ pull(controller) {
      const next = chunks.shift();
      if (next) controller.enqueue(next);
      else if (extra === 0) controller.close();
    }, cancel });
    let signal: AbortSignal | undefined;
    const { client } = fixture(init => {
      signal = init?.signal ?? undefined;
      return new Response(body, { headers: contentLength ? { 'content-length': contentLength } : {} });
    });
    const result = await client.fetchVideo(videoId);
    if (!result.ok) throw result.error;
    if (extra === 0) {
      expect(result.value.description).toBe(text);
      expect(result.value.creatorNoteAcquisition?.state).toBe('available');
    } else {
      expect(result.value.description).toBeUndefined();
      expect(result.value.creatorNoteAcquisition).toEqual({ state: 'failed', method: 'youtube-watch-page', reason: 'output-limit' });
      expect(signal?.aborted).toBe(true);
      expect(cancel).toHaveBeenCalledOnce();
    }
    vi.restoreAllMocks();
  }
});

it.each(['headers', 'body'] as const)('enforces one fifteen-second deadline through stalled %s', async stage => {
  vi.useFakeTimers();
  const cancel = vi.fn();
  const body = new ReadableStream<Uint8Array>({ start(controller) {
    controller.enqueue(new TextEncoder().encode('<html>partial'));
  }, cancel });
  let signal: AbortSignal | undefined;
  const { client } = fixture(init => {
    signal = init?.signal ?? undefined;
    if (stage === 'body') return new Promise<Response>(resolve => {
      setTimeout(() => resolve(new Response(body)), 10_000);
    });
    return new Promise<Response>((_resolve, reject) => {
      signal?.addEventListener('abort', () => reject(new Error('Controlled fetch aborted')), { once: true });
    });
  });
  let settled = false;
  const pending = client.fetchVideo(videoId).then(result => { settled = true; return result; });
  expect(signal).toBeDefined();
  await vi.advanceTimersByTimeAsync(14_999);
  expect(settled).toBe(false);
  await vi.advanceTimersByTimeAsync(1);
  const result = await pending;
  if (!result.ok) throw result.error;
  expect(result.value.creatorNoteAcquisition).toEqual({ state: 'failed', method: 'youtube-watch-page', reason: 'timeout' });
  expect(signal?.aborted).toBe(true);
  expect(vi.getTimerCount()).toBe(0);
  if (stage === 'body') {
    expect(cancel).toHaveBeenCalledOnce();
    expect(body.locked).toBe(false);
  }
});

it.each([false, true])('settles creator cancellation (reject=%s) before returning the oEmbed failure with its original cause', async rejectCancel => {
  let rejectOembed!: (error: Error) => void;
  const original = new Error('Controlled oEmbed failure');
  let signal: AbortSignal | undefined;
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({ cancel: async () => {
    await Promise.resolve(); cancelled = true;
    if (rejectCancel) throw new Error('Controlled cancellation rejection');
  } });
  const { client } = fixture(init => { signal = init?.signal ?? undefined; return new Response(body); },
    () => new Promise<Response>((_resolve, reject) => { rejectOembed = reject; }));
  const pending = client.fetchVideo(videoId);
  await new Promise(resolve => setImmediate(resolve));
  rejectOembed(original);
  const result = await pending;
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error('Expected oEmbed failure');
  expect(result.error.message).toBe(`youtube oEmbed fetch failed for ${videoId}: ${original.message}`);
  expect(result.error.cause).toBe(original);
  expect(signal?.aborted).toBe(true);
  expect(cancelled).toBe(true);
});

it('returns at the body deadline and releases its lock when underlying cancellation never settles', async () => {
  vi.useFakeTimers();
  const cancel = vi.fn(() => new Promise<void>(() => {}));
  const body = new ReadableStream<Uint8Array>({ cancel });
  let signal: AbortSignal | undefined;
  const { client } = fixture(init => { signal = init?.signal ?? undefined; return new Response(body); });
  let settled = false;
  const pending = client.fetchVideo(videoId).then(result => { settled = true; return result; });
  await vi.advanceTimersByTimeAsync(15_000);
  // Assert before awaiting the result: the old cleanup wait would otherwise hang this test.
  expect(settled, 'A pending cancellation promise must not extend the creator deadline').toBe(true);
  expect(body.locked).toBe(false);
  expect(signal?.aborted).toBe(true);
  expect(cancel).toHaveBeenCalledOnce();
  const result = await pending;
  if (!result.ok) throw result.error;
  expect(result.value.creatorNoteAcquisition).toEqual({
    state: 'failed', method: 'youtube-watch-page', reason: 'timeout',
  });
});

it('retains the original oEmbed cause when underlying cancellation never settles', async () => {
  vi.useFakeTimers();
  const original = new Error('Controlled primary failure');
  let rejectOembed!: (error: Error) => void;
  const cancel = vi.fn(() => new Promise<void>(() => {}));
  const body = new ReadableStream<Uint8Array>({ cancel });
  const { client } = fixture(() => new Response(body),
    () => new Promise<Response>((_resolve, reject) => { rejectOembed = reject; }));
  let settled = false;
  const pending = client.fetchVideo(videoId).then(result => { settled = true; return result; });
  await vi.advanceTimersByTimeAsync(0);
  rejectOembed(original);
  await vi.advanceTimersByTimeAsync(0);
  expect(settled, 'A pending cancellation promise must not hide the original primary error').toBe(true);
  expect(body.locked).toBe(false);
  expect(cancel).toHaveBeenCalledOnce();
  const result = await pending;
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error('Expected oEmbed failure');
  expect(result.error.message).toBe(`youtube oEmbed fetch failed for ${videoId}: ${original.message}`);
  expect(result.error.cause).toBe(original);
  expect(vi.getTimerCount()).toBe(0);
});

it('handles an early creator rejection immediately while the primary request is pending', async () => {
  let resolveOembed!: (response: Response) => void;
  const unhandled = vi.fn();
  process.on('unhandledRejection', unhandled);
  try {
    const { client } = fixture(() => Promise.reject(new Error('Controlled creator rejection')),
      () => new Promise<Response>(resolve => { resolveOembed = resolve; }));
    const pending = client.fetchVideo(videoId);
    await new Promise(resolve => setImmediate(resolve));
    expect(unhandled).not.toHaveBeenCalled();
    resolveOembed(new Response(JSON.stringify(basics)));
    const result = await pending;
    if (!result.ok) throw result.error;
    expect(result.value.creatorNoteAcquisition).toEqual({ state: 'failed', method: 'youtube-watch-page', reason: 'execution' });
  } finally { process.off('unhandledRejection', unhandled); }
});
