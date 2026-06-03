import { afterEach, describe, expect, it, vi } from 'vitest';
import { RealYouTubeClient } from '../src/client/youtube.js';

describe('RealYouTubeClient config isolation', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does not share cookie config across client instances', async () => {
    const cookiesSeen: string[] = [];
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input.toString();
        const headers = new Headers(init?.headers);
        if (url.includes('youtube.com/watch?v=')) {
          cookiesSeen.push(headers.get('Cookie') ?? '');
        }
        return new Response('', { status: 500 });
      });

    const noYtDlp = {
      bin: '/definitely/missing/yt-dlp',
      jsRuntimes: 'node',
      remoteComponents: '',
      timeoutMs: 1,
      keepFiles: false,
      debugTranscript: false,
    };
    const clientA = new RealYouTubeClient({ cookie: 'cookie-A', debugTranscript: false }, noYtDlp);
    // Creating a second client must not mutate clientA behavior.
    // Previous implementation used shared module state and would leak this config.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const clientB = new RealYouTubeClient({ cookie: 'cookie-B', debugTranscript: false }, noYtDlp);

    const result = await clientA.fetchTranscript('video-one');
    expect(result.ok).toBe(false);
    expect(fetchMock).toHaveBeenCalled();
    expect(cookiesSeen.length).toBeGreaterThan(0);
    expect(cookiesSeen[0]).toContain('cookie-A');
    expect(cookiesSeen[0]).not.toContain('cookie-B');
  });

  it('adds operation context to video metadata network failures', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('fetch failed'));

    const client = new RealYouTubeClient({ debugTranscript: false });
    const result = await client.fetchVideo('video-one');

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toContain('youtube oEmbed fetch failed for video-one');
    expect(result.error.message).toContain('fetch failed');
  });

  it('adds operation context to transcript network failures', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('fetch failed'));

    const noYtDlp = {
      bin: '/definitely/missing/yt-dlp',
      jsRuntimes: 'node',
      remoteComponents: '',
      timeoutMs: 1,
      keepFiles: false,
      debugTranscript: false,
    };
    const client = new RealYouTubeClient({ debugTranscript: false }, noYtDlp);
    const result = await client.fetchTranscript('video-one');

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toContain('No transcript segments found for video-one');
    expect(result.error.message).toContain('youtube timedtext track-list fetch failed for video-one');
    expect(result.error.message).toContain('fetch failed');
  });
});
