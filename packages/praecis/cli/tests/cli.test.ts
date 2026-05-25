import { describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import type { LlmClient, PipelineServices } from '@aidha/praecis-core';
import {
  explainResolvedKey,
  resolveAidhaConfig,
  runEmailIngest,
  runLinkedInIngest,
  runMeetingIngest,
  runReadwiseIngest,
  runPodcastIngest,
  runPdfIngest,
  runRssIngest,
  runVoiceIngest,
  runWebIngest,
} from '../src/index.js';

function testConfig(): PipelineServices['config'] {
  return {
    baseDir: process.cwd(),
    db: ':memory:',
    llm: {
      model: 'test-model',
      apiKey: '',
      baseUrl: 'http://localhost/v1',
      timeoutMs: 1000,
      cacheDir: join(tmpdir(), `aidha-cli-claims-${process.pid}`),
      reasoningEffort: 'medium',
      verbosity: 'medium',
      embeddingBatchSize: 20,
      embeddingTaskType: 'SEMANTIC_SIMILARITY',
      embeddingOutputDimensionality: 768,
    },
    editor: {
      version: 'v2',
      windowMinutes: 5,
      maxPerWindow: 3,
      minWindows: 1,
      minWords: 1,
      minChars: 1,
      editorLlm: false,
    },
    extraction: {
      maxClaims: 3,
      chunkMinutes: 5,
      maxChunks: 0,
      promptVersion: 'v2',
    },
    export: { outDir: './out', sourcePrefix: 'test' },
  };
}

function fakeLlm(): LlmClient {
  return {
    async generate(request) {
      const excerptId = /"id":\s*"([^"]+)"/.exec(request.user)?.[1] ?? 'chunk-0';
      const textMatch = /"text":\s*"([^"]+)"/.exec(request.user);
      const sourceText = textMatch?.[1]?.replace(/\\n/g, ' ') ?? 'fixture evidence';
      const prefix = sourceText.split(/\s+/).filter(Boolean).slice(0, 5).join(' ') || 'The fixture';
      return {
        ok: true,
        value: JSON.stringify({
          claims: [{
            text: `${prefix} supports a reviewable synthesized claim.`,
            excerptIds: [excerptId],
            confidence: 0.84,
            type: 'fact',
            classification: 'fact',
            startSeconds: 0,
            evidenceType: 'direct',
            why: 'Synthesized by the canonical extractor test double.',
          }],
        }),
      };
    },
  };
}

function services(): Partial<PipelineServices> {
  return { config: testConfig(), llm: fakeLlm() };
}

function makeFetchResponse(url: string, html: string) {
  return {
    ok: true,
    url,
    status: 200,
    text: async () => html,
  };
}

function expectDraftClaims(summary: {
  claimsExtracted: number;
  claimIds: readonly string[];
  claims: readonly { text: string; method?: unknown; model?: unknown; promptVersion?: unknown }[];
}) {
  expect(summary.claimsExtracted).toBeGreaterThan(0);
  expect(summary.claimIds.length).toBe(summary.claimsExtracted);
  expect(summary.claims.length).toBe(summary.claimsExtracted);
  expect(summary.claims.every(claim => claim.method === 'llm')).toBe(true);
  expect(summary.claims.every(claim => claim.model === 'test-model')).toBe(true);
  expect(summary.claims.every(claim => claim.promptVersion)).toBe(true);
}

describe('aidha cli phase-1 surface', () => {
  it('ingests web fixtures with deterministic canonical ids and chunks', async () => {
    const summary = await runWebIngest('https://example.com/article', async () => ({
      ...makeFetchResponse(
        'https://example.com/article',
        '<html><body><article><h1>Example</h1><p>First paragraph.</p><p>Second paragraph.</p></article></body></html>',
      ),
    }), services());

    expect(summary.sourceId).toBe('web');
    expect(summary.canonicalId).toBe('web:https://example.com/article');
    expect(summary.segmentCount).toBeGreaterThan(0);
    expect(summary.chunkCount).toBeGreaterThan(0);
    expectDraftClaims(summary);
  });

  it('ingests pdf fixtures with page locators', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'aidha-cli-pdf-'));
    const filePath = join(dir, 'paper.pdf');
    await writeFile(filePath, Buffer.from('First page\fSecond page'));

    const summary = await runPdfIngest(filePath, readFile, services());
    const expectedHash = createHash('sha256').update(Buffer.from('First page\fSecond page')).digest('hex');

    expect(summary.sourceId).toBe('pdf');
    expect(summary.canonicalId).toBe(`pdf:${expectedHash}`);
    expect(summary.segmentCount).toBe(2);
    expect(summary.segments[0]?.locator.kind).toBe('page');
    expectDraftClaims(summary);
  });

  it('ingests voice fixtures with deterministic timecoded segments', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'aidha-cli-voice-'));
    const filePath = join(dir, 'note.m4a');
    await writeFile(filePath, Buffer.from('voice note alpha beta gamma delta', 'utf8'));

    const summary = await runVoiceIngest(filePath, services());
    const expectedHash = createHash('sha256').update(Buffer.from('voice note alpha beta gamma delta', 'utf8')).digest('hex');

    expect(summary.sourceId).toBe('voice');
    expect(summary.canonicalId).toBe(`voice:${expectedHash}`);
    expect(summary.segmentCount).toBeGreaterThan(0);
    expect(summary.segments[0]?.locator.kind).toBe('timecode');
    expectDraftClaims(summary);
  });

  it('ingests meeting fixtures with diarized timecoded segments', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'aidha-cli-meeting-'));
    const filePath = join(dir, 'standup.wav');
    await writeFile(filePath, Buffer.from('meeting transcript alpha beta gamma delta epsilon zeta eta theta', 'utf8'));

    const summary = await runMeetingIngest(filePath, services());
    const expectedHash = createHash('sha256').update(Buffer.from('meeting transcript alpha beta gamma delta epsilon zeta eta theta', 'utf8')).digest('hex');

    expect(summary.sourceId).toBe('meeting');
    expect(summary.canonicalId).toBe(`meeting:${expectedHash}`);
    expect(summary.segmentCount).toBeGreaterThan(0);
    expect(summary.segments[0]?.locator.kind).toBe('timecode');
    expect(summary.segments[0]?.label).toBeDefined();
    expectDraftClaims(summary);
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
      services: services(),
    });

    expect(summary.sourceId).toBe('rss');
    expect(summary.canonicalId).toBe('web:https://example.com/article');
    expect(summary.segmentCount).toBeGreaterThan(0);
    expectDraftClaims(summary);
  });

  it('ingests podcast fixtures and diarizes panel episodes', async () => {
    const summary = await runPodcastIngest('https://pod.example.com/feed.xml', {
      episodeGuid: 'episode-2',
      panel: true,
      services: services(),
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
    expectDraftClaims(summary);
  });

  it('ingests readwise exports with the shared web canonical id and highlight locators', async () => {
    const summary = await runReadwiseIngest('2026-05-01T00:00:00Z', {
      token: 'token-123',
      services: services(),
      fetchFn: async (url) => {
        expect(url).toContain('updatedAfter=2026-05-01T00%3A00%3A00Z');
        return {
          ok: true,
          status: 200,
          async json() {
            return {
              count: 1,
              nextPageCursor: null,
              results: [
                {
                  user_book_id: 11,
                  title: 'How to Do What You Love',
                  author: 'Paul Graham',
                  source_url: 'https://example.com/article?utm_source=readwise',
                  readwise_url: 'https://readwise.io/bookreview/11',
                  highlights: [
                    { id: 1, text: 'First quote', book_id: 11, updated_at: '2026-05-22T00:00:00.000Z' },
                    { id: 2, text: 'Second quote', book_id: 11, updated_at: '2026-05-22T00:00:00.000Z' },
                  ],
                },
              ],
            };
          },
        };
      },
    });

    expect(summary.sourceId).toBe('readwise');
    expect(summary.totalBooks).toBe(1);
    expect(summary.summaries[0]?.canonicalId).toBe('web:https://example.com/article');
    expect(summary.summaries[0]?.segments[0]?.locator).toEqual({ kind: 'external', system: 'readwise', externalId: '1' });
    expectDraftClaims(summary.summaries[0]!);
  });

  it('ingests email fixtures into a reparented thread summary', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'aidha-cli-email-'));
    await writeFile(
      join(dir, 'leaf.eml'),
      [
        'Message-ID: <msg-c>',
        'Date: Thu, 22 May 2026 10:00:00 +0000',
        'From: Carol <carol@example.com>',
        'To: Bob <bob@example.com>',
        'Subject: Re: Project status',
        'In-Reply-To: <msg-b>',
        '',
        'Leaf body',
      ].join('\r\n'),
    );
    await writeFile(
      join(dir, 'root.eml'),
      [
        'Message-ID: <msg-b>',
        'Date: Thu, 22 May 2026 11:00:00 +0000',
        'From: Bob <bob@example.com>',
        'To: Alice <alice@example.com>',
        'Subject: Re: Project status',
        'References: <msg-a>',
        'In-Reply-To: <msg-a>',
        '',
        'Root body',
      ].join('\r\n'),
    );

    const summary = await runEmailIngest(dir, services());

    expect(summary.sourceId).toBe('email');
    expect(summary.threads).toBe(1);
    expect(summary.importedFiles).toBe(2);
    expect(summary.summaries[0]?.canonicalId).toBe('email:thread:msg-a');
    expect(summary.summaries[0]?.segmentCount).toBe(2);
    expectDraftClaims(summary.summaries[0]!);
  }, 30_000);

  it('ingests linkedin paste fixtures with optional activity urn provenance', async () => {
    const summary = await runLinkedInIngest(
      'https://www.linkedin.com/feed/update/urn:li:activity:1234567890/',
      {
        pasteText: 'First paragraph.\n\nSecond paragraph.',
        url: 'https://www.linkedin.com/feed/update/urn:li:activity:1234567890/',
        services: services(),
      },
    );

    expect(summary.sourceId).toBe('linkedin');
    expect(summary.canonicalId).toBe('linkedin:urn:li:activity:1234567890');
    expect(summary.segmentCount).toBe(2);
    expect(summary.segments[0]?.locator.kind).toBe('text');
    expectDraftClaims(summary);
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
