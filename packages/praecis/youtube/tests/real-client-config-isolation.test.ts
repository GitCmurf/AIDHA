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

    const clientA = new RealYouTubeClient({ cookie: 'cookie-A', debugTranscript: false });
    // Creating a second client must not mutate clientA behavior.
    // Previous implementation used shared module state and would leak this config.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const clientB = new RealYouTubeClient({ cookie: 'cookie-B', debugTranscript: false });

    const result = await clientA.fetchTranscript('video-one');
    expect(result.ok).toBe(false);
    expect(fetchMock).toHaveBeenCalled();
    expect(cookiesSeen.length).toBeGreaterThan(0);
    expect(cookiesSeen[0]).toContain('cookie-A');
    expect(cookiesSeen[0]).not.toContain('cookie-B');
  });
});
