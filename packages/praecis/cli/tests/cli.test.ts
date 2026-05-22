import { describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import {
  explainResolvedKey,
  resolveAidhaConfig,
  runMeetingIngest,
  runPodcastIngest,
  runPdfIngest,
  runRssIngest,
  runVoiceIngest,
  runWebIngest,
} from '../src/index.js';

function makeFetchResponse(url: string, html: string) {
  return {
    ok: true,
    url,
    status: 200,
    text: async () => html,
  };
}

describe('aidha cli phase-1 surface', () => {
  it('ingests web fixtures with deterministic canonical ids and chunks', async () => {
    const summary = await runWebIngest('https://example.com/article', async () => ({
      ...makeFetchResponse(
        'https://example.com/article',
        '<html><body><article><h1>Example</h1><p>First paragraph.</p><p>Second paragraph.</p></article></body></html>',
      ),
    }));

    expect(summary.sourceId).toBe('web');
    expect(summary.canonicalId).toBe('web:https://example.com/article');
    expect(summary.segmentCount).toBeGreaterThan(0);
    expect(summary.chunkCount).toBeGreaterThan(0);
  });

  it('ingests pdf fixtures with page locators', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'aidha-cli-pdf-'));
    const filePath = join(dir, 'paper.pdf');
    await writeFile(filePath, Buffer.from('First page\fSecond page'));

    const summary = await runPdfIngest(filePath, readFile);
    const expectedHash = createHash('sha256').update(Buffer.from('First page\fSecond page')).digest('hex');

    expect(summary.sourceId).toBe('pdf');
    expect(summary.canonicalId).toBe(`pdf:${expectedHash}`);
    expect(summary.segmentCount).toBe(2);
    expect(summary.segments[0]?.locator.kind).toBe('page');
  });

  it('ingests voice fixtures with deterministic timecoded segments', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'aidha-cli-voice-'));
    const filePath = join(dir, 'note.m4a');
    await writeFile(filePath, Buffer.from('voice note alpha beta gamma delta', 'utf8'));

    const summary = await runVoiceIngest(filePath);
    const expectedHash = createHash('sha256').update(Buffer.from('voice note alpha beta gamma delta', 'utf8')).digest('hex');

    expect(summary.sourceId).toBe('voice');
    expect(summary.canonicalId).toBe(`voice:${expectedHash}`);
    expect(summary.segmentCount).toBeGreaterThan(0);
    expect(summary.segments[0]?.locator.kind).toBe('timecode');
  });

  it('ingests meeting fixtures with diarized timecoded segments', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'aidha-cli-meeting-'));
    const filePath = join(dir, 'standup.wav');
    await writeFile(filePath, Buffer.from('meeting transcript alpha beta gamma delta epsilon zeta eta theta', 'utf8'));

    const summary = await runMeetingIngest(filePath);
    const expectedHash = createHash('sha256').update(Buffer.from('meeting transcript alpha beta gamma delta epsilon zeta eta theta', 'utf8')).digest('hex');

    expect(summary.sourceId).toBe('meeting');
    expect(summary.canonicalId).toBe(`meeting:${expectedHash}`);
    expect(summary.segmentCount).toBeGreaterThan(0);
    expect(summary.segments[0]?.locator.kind).toBe('timecode');
    expect(summary.segments[0]?.label).toBeDefined();
  });

  it('ingests rss fixtures and resolves linked articles through the shared web identity', async () => {
    const summary = await runRssIngest('https://blog.example.com/feed.xml', {
      itemGuid: 'item-1',
      fetchFn: async (url) => {
        if (url === 'https://blog.example.com/feed.xml') {
          return makeFetchResponse(
            url,
            `<?xml version="1.0"?><rss><channel><title>Example feed</title><item><guid>item-1</guid><title>Example item</title><link>https://example.com/article</link><description>Short summary</description><category>news</category></item></channel></rss>`,
          );
        }

        return makeFetchResponse(url, '<html><body><article><p>Linked article text.</p></article></body></html>');
      },
    });

    expect(summary.sourceId).toBe('rss');
    expect(summary.canonicalId).toBe('web:https://example.com/article');
    expect(summary.segmentCount).toBeGreaterThan(0);
  });

  it('ingests podcast fixtures and diarizes panel episodes', async () => {
    const summary = await runPodcastIngest('https://pod.example.com/feed.xml', {
      episodeGuid: 'episode-2',
      panel: true,
      fetchFn: async (url) => {
        if (url === 'https://pod.example.com/feed.xml') {
          return {
            ok: true,
            url,
            status: 200,
            async text() {
              return `<?xml version="1.0"?><rss><channel><title>Example podcast</title><item><title>Panel episode</title><guid>episode-2</guid><link>https://pod.example.com/panel-notes</link><description>Panel summary</description><category>Panel</category><enclosure url="https://cdn.example.com/panel.m4a" type="audio/mp4" /></item></channel></rss>`;
            },
            async arrayBuffer() {
              return new TextEncoder().encode('feed').buffer;
            },
          };
        }
        if (url === 'https://pod.example.com/panel-notes') {
          return {
            ok: true,
            url,
            status: 200,
            async text() {
              return '<html><body><article><h1>Panel episode</h1><p>Show notes.</p></article></body></html>';
            },
            async arrayBuffer() {
              return new TextEncoder().encode('notes').buffer;
            },
          };
        }
        return {
          ok: true,
          url,
          status: 200,
          async text() {
            return 'panel episode audio alpha beta gamma delta epsilon zeta eta theta';
          },
          async arrayBuffer() {
            return new TextEncoder().encode('panel episode audio alpha beta gamma delta epsilon zeta eta theta').buffer;
          },
        };
      },
    });

    expect(summary.sourceId).toBe('podcast');
    expect(summary.canonicalId).toBe('podcast:https://cdn.example.com/panel.m4a');
    expect(summary.segmentCount).toBeGreaterThan(0);
    expect(summary.segments[0]?.locator.kind).toBe('timecode');
    expect(summary.segments[0]?.locator.speaker).toBeDefined();
  });

  it('explains config provenance for source registrations', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'aidha-cli-config-'));
    const configPath = join(dir, 'config.yaml');
    await mkdir(dir, { recursive: true });
    await writeFile(
      configPath,
      [
        'config_version: 1',
        'default_profile: default',
        'profiles:',
        '  default:',
        '    source_overrides:',
        '      youtube:',
        '        ytdlp:',
        '          timeout_ms: 45000',
        'sources:',
        '  youtube:',
        '    ytdlp:',
        '      timeout_ms: 120000',
      ].join('\n'),
    );

    const resolved = await resolveAidhaConfig({ configPath, source: 'youtube' });
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;

    const output = explainResolvedKey('activeSourceConfig', resolved, { source: 'youtube' });
    expect(output).toContain('youtube');
    expect(output).toContain('ytdlp');
  });
});
