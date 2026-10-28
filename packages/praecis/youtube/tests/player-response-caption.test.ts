import { afterEach, expect, it, vi } from 'vitest';
import { RealYouTubeClient } from '../src/client/youtube.js';

afterEach(() => vi.restoreAllMocks());

const videoId = 'captionfx01';
const track = 'https://www.youtube.com/api/timedtext?v=captionfx01&lang=en';
const expectedText = 'The fictional workshop labels each sample.';
const player = { videoDetails: { videoId }, captions: { playerCaptionsTracklistRenderer: {
  captionTracks: [{ baseUrl: track, languageCode: 'en', name: { simpleText: 'English' } }],
} } };

it.each(['literal', 'JSON.parse', 'literal followed by same-video JSON.parse decoy'])(
  'uses the immediate %s player RHS through the actual caption HTML fallback', async variant => {
    const rhs = variant === 'JSON.parse' ? `JSON.parse(${JSON.stringify(JSON.stringify(player))})`
      : JSON.stringify(player);
    const decoy = variant.includes('decoy')
      ? `; const unrelated = JSON.parse(${JSON.stringify(JSON.stringify({ videoDetails: { videoId },
        captions: { playerCaptionsTracklistRenderer: { captionTracks: [{ baseUrl: 'https://example.test/wrong',
          languageCode: 'en' }] } } }))})` : '';
    const html = `<script>var ytInitialPlayerResponse = ${rhs}${decoy};</script>`;
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = new URL(String(input));
      if (url.pathname === '/watch') {
        expect(new Headers(init?.headers).get('Cookie')).toContain('caption-cookie');
        return new Response(html);
      }
      expect(url.origin).toBe('https://www.youtube.com');
      expect(url.pathname).toBe('/api/timedtext');
      return new Response(JSON.stringify({ events: [{ tStartMs: 0, dDurationMs: 2000,
        segs: [{ utf8: expectedText }] }] }));
    });
    const result = await new RealYouTubeClient({ cookie: 'caption-cookie', debugTranscript: false })
      .fetchTranscript(videoId);
    if (!result.ok) throw result.error;
    expect(result.value.fullText).toBe(expectedText);
    expect(fetch.mock.calls).toHaveLength(2);
  });
