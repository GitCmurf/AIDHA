import { describe, expect, it } from 'vitest';
import { createPodcastVectorSpec, PodcastIngestor } from '../src/index.js';

const feedXml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Example Podcast</title>
    <item>
      <title>Solo episode</title>
      <guid>episode-1</guid>
      <link>https://pod.example.com/solo-notes</link>
      <description>Solo episode summary.</description>
      <enclosure url="https://cdn.example.com/solo.mp3" type="audio/mpeg" length="12345" />
    </item>
    <item>
      <title>Panel discussion</title>
      <guid>episode-2</guid>
      <link>https://pod.example.com/panel-notes</link>
      <description>Panel discussion summary.</description>
      <category>Panel</category>
      <enclosure url="https://cdn.example.com/panel.m4a" type="audio/mp4" length="23456" />
    </item>
  </channel>
</rss>`;

const notesHtml = (title: string) => `<html><body><article><h1>${title}</h1><p>Show notes body.</p></article></body></html>`;

function makeResponse(url: string, body: string | Uint8Array) {
  const bytes = typeof body === 'string' ? new TextEncoder().encode(body) : body;
  return {
    ok: true,
    url,
    status: 200,
    async text() {
      return typeof body === 'string' ? body : new TextDecoder().decode(bytes);
    },
    async arrayBuffer() {
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    },
  };
}

function makeFetch() {
  return async (url: string) => {
    if (url === 'https://pod.example.com/feed.xml') {
      return makeResponse(url, feedXml);
    }
    if (url === 'https://pod.example.com/solo-notes') {
      return makeResponse(url, notesHtml('Solo episode'));
    }
    if (url === 'https://pod.example.com/panel-notes') {
      return makeResponse(url, notesHtml('Panel discussion'));
    }
    if (url === 'https://cdn.example.com/solo.mp3') {
      return makeResponse(url, Buffer.from('solo episode audio bytes'));
    }
    if (url === 'https://cdn.example.com/panel.m4a') {
      return makeResponse(url, Buffer.from('panel episode audio bytes'));
    }
    return {
      ok: false,
      url,
      status: 404,
      async text() {
        return 'not found';
      },
      async arrayBuffer() {
        return new TextEncoder().encode('not found').buffer;
      },
    };
  };
}

describe('PodcastIngestor', () => {
  it('selects an episode by guid and uses the enclosure url as the primary identity', async () => {
    const ingestor = new PodcastIngestor({ fetchFn: makeFetch() });
    const result = await ingestor.acquire({ ref: 'https://pod.example.com/feed.xml', metadata: { episodeGuid: 'episode-1' } });

    expect(result.ok).toBe(true);
    if (!result.ok) throw result.error;
    expect(result.value.canonicalId).toBe('podcast:https://cdn.example.com/solo.mp3');
    expect(result.value.label).toBe('Solo episode');
    expect(result.value.payload.showNotesUrl).toBe('https://pod.example.com/solo-notes');
    expect(result.value.dedupKeys).toContain('episode-1');
    expect(result.value.dedupKeys).toContain('https://cdn.example.com/solo.mp3');
    expect(result.value.resourceMetadata).toMatchObject({
      title: 'Solo episode',
      episodeTitle: 'Solo episode',
      feedTitle: 'Example Podcast',
      feedUrl: 'https://pod.example.com/feed.xml',
      guid: 'episode-1',
      enclosureUrl: 'https://cdn.example.com/solo.mp3',
      mimeType: 'audio/mpeg',
      showNotesUrl: 'https://pod.example.com/solo-notes',
      panel: false,
    });
  });
});

describe('createPodcastVectorSpec', () => {
  it('builds a monologue podcast vector with timecoded segments', async () => {
    const vector = createPodcastVectorSpec({
      fetchFn: makeFetch(),
      mockTranscriber: { transcriptText: 'solo episode transcript alpha beta gamma delta epsilon zeta eta theta' },
    });

    const result = await vector.ingestAndDecode({ ref: 'https://pod.example.com/feed.xml', metadata: { episodeGuid: 'episode-1' } });

    expect(result.ok).toBe(true);
    if (!result.ok) throw result.error;
    expect(result.value.raw.canonicalId).toBe('podcast:https://cdn.example.com/solo.mp3');
    expect(result.value.segments.length).toBeGreaterThan(0);
    expect(result.value.segments[0]!.locator.kind).toBe('timecode');
  });

  it('adds speaker labels for panel episodes', async () => {
    const vector = createPodcastVectorSpec({
      fetchFn: makeFetch(),
      mockTranscriber: { transcriptText: 'panel episode transcript alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi' },
      mockDiarizer: { speakerLabels: ['Host', 'Guest'] },
    });

    const result = await vector.ingestAndDecode({
      ref: 'https://pod.example.com/feed.xml',
      metadata: { episodeGuid: 'episode-2', panel: true },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw result.error;
    expect(result.value.raw.canonicalId).toBe('podcast:https://cdn.example.com/panel.m4a');
    expect(result.value.segments[0]!.locator.kind).toBe('timecode');
    expect(result.value.segments[0]!.locator.speaker).toBeDefined();
    expect(result.value.segments[0]!.label).toBeDefined();
  });
});
