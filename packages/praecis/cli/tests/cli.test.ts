import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import type { ComposedVector, IngestInput, LlmClient, PipelineServices, RunReport } from '@aidha/praecis-core';
import { SQLiteStore } from '@aidha/graph-backend';
import { MockYouTubeClient } from '@aidha/ingestion-youtube';
import {
  explainResolvedKey,
  resolveRuntimeServicesForSource,
  resolveAidhaConfig,
  runEmailIngest,
  runLinkedInIngest,
  runMeetingIngest,
  runReadwiseIngest,
  runPodcastIngest,
  runPdfIngest,
  runRssIngest,
  runCli,
  runVoiceIngest,
  runWebIngest,
  runYouTubeIngest,
  runYouTubePlaylistIngest,
  SOURCE_MANIFESTS,
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

function taxonomyServices(): Partial<PipelineServices> {
  return {
    config: {
      ...testConfig(),
      extensions: {
        global: {
          taxonomy: {
            categories: [{ id: 'cat-1', name: 'Social' }],
            topics: [{ id: 'topic-1', name: 'Posts', categoryId: 'cat-1' }],
            tags: [{ id: 'tag-1', name: 'linkedin', topicIds: ['topic-1'] }],
          },
        },
      },
    },
    llm: fakeLlm(),
    clock: { now: () => new Date('2026-05-25T12:34:56.000Z') },
  };
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

function reportFor(sourceId: string, ref: string): RunReport {
  return {
    sourceId,
    canonicalId: `${sourceId}:${ref}`,
    resourceId: `${sourceId}:${ref}`,
    excerptCount: 1,
    chunkCount: 1,
    segmentCount: 1,
    segments: [],
    chunks: [],
    excerptIds: [`${sourceId}:excerpt:${ref}`],
    claimsExtracted: 0,
    claimIds: [],
    claims: [],
    dedupAction: 'create',
    policyRoute: 'disabled',
    cacheHits: 0,
    cacheWrites: 0,
    tokenUsage: 0,
    spendUsd: 0,
    warnings: [],
    classification: { status: 'disabled', tagsMatched: 0, tagsAssigned: 0, warnings: [] },
    metadataConflictCount: 0,
    references: {
      referencesCreated: 1,
      referencesUpdated: 0,
      referencesNoop: 0,
      referenceEdgesCreated: 1,
      referenceEdgesUpdated: 0,
      referenceEdgesNoop: 0,
    },
    durationMs: 0,
  };
}

describe('aidha cli phase-1 surface', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('derives source command ids and usage from a unique manifest registry', () => {
    const sourceIds = SOURCE_MANIFESTS.map(manifest => manifest.sourceId);
    const usageLines = SOURCE_MANIFESTS.map(manifest => manifest.usage);
    const registrationIds = SOURCE_MANIFESTS.map(manifest => manifest.registration.sourceId);

    expect(new Set(sourceIds).size).toBe(SOURCE_MANIFESTS.length);
    expect(new Set(usageLines).size).toBe(SOURCE_MANIFESTS.length);
    expect(new Set(registrationIds).size).toBe(SOURCE_MANIFESTS.length);
    expect(SOURCE_MANIFESTS.map(manifest => manifest.usage)).toEqual([
      'aidha ingest youtube (--url <videoIdOrUrl> | --playlist <playlistIdOrUrl>) [--mock] [--json]',
      'aidha ingest web --url <url> [--json]',
      'aidha ingest pdf --file <path> [--json]',
      'aidha ingest voice --file <path> [--json]',
      'aidha ingest meeting --file <path> [--json]',
      'aidha ingest rss --feed <url> [--item-guid <guid>] [--json]',
      'aidha ingest podcast --feed <url> [--episode <guid>] [--panel] [--json]',
      'aidha ingest readwise --since <iso8601> [--token <token>] [--json]',
      'aidha ingest email --file <path> [--json]',
      'aidha ingest linkedin --paste <text> [--url <url>] [--json]',
    ]);
  });

  it('prints help from the source manifest registry instead of a parallel usage list', async () => {
    const logs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((value?: unknown) => {
      logs.push(String(value));
    });

    const code = await runCli([]);
    expect(code).toBe(0);
    const helpText = logs.join('\n');
    for (const manifest of SOURCE_MANIFESTS) {
      expect(helpText).toContain(manifest.usage);
    }
  });

  it('ingests youtube through the generic source-neutral CLI runtime', async () => {
    const summary = await runYouTubeIngest('test-video', {
      client: new MockYouTubeClient(),
      services: services(),
    });

    expect(summary.sourceId).toBe('youtube');
    expect(summary.canonicalId).toBe('youtube-test-video');
    expect(summary.segmentCount).toBeGreaterThan(0);
    expect(summary.segments[0]?.locator.kind).toBe('timecode');
    expectDraftClaims(summary);
  });

  it('exposes youtube on the generic aidha ingest command surface', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'aidha-cli-youtube-'));
    const dbPath = join(dir, 'aidha.sqlite');
    const configPath = join(dir, 'config.yaml');
    await writeFile(
      configPath,
      [
        'config_version: 1',
        'default_profile: default',
        'profiles:',
        '  default:',
        `    db: ${JSON.stringify(dbPath)}`,
        '    llm:',
        '      model: ""',
        '      base_url: ""',
      ].join('\n'),
    );
    const logs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((value?: unknown) => {
      logs.push(String(value));
    });

    try {
      const code = await runCli(['ingest', 'youtube', '--url', 'test-video', '--mock', '--json', '--config', configPath]);
      expect(code).toBe(0);
      const summary = JSON.parse(logs.join('\n')) as { sourceId: string; canonicalId: string; claimsExtracted: number };
      expect(summary.sourceId).toBe('youtube');
      expect(summary.canonicalId).toBe('youtube-test-video');
      expect(summary.claimsExtracted).toBeGreaterThan(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 60_000);

  it('ingests youtube playlists through the same generic command surface', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'aidha-cli-youtube-playlist-'));
    const dbPath = join(dir, 'aidha.sqlite');
    const configPath = join(dir, 'config.yaml');
    await writeFile(
      configPath,
      [
        'config_version: 1',
        'default_profile: default',
        'profiles:',
        '  default:',
        `    db: ${JSON.stringify(dbPath)}`,
        '    llm:',
        '      model: ""',
        '      base_url: ""',
      ].join('\n'),
    );
    const logs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((value?: unknown) => {
      logs.push(String(value));
    });

    try {
      const code = await runCli(['ingest', 'youtube', '--playlist', 'test-playlist', '--mock', '--json', '--config', configPath]);
      expect(code).toBe(0);
      const summary = JSON.parse(logs.join('\n')) as {
        sourceId: string;
        playlistId: string;
        videos: number;
        itemCount: number;
        classification: { status: string; tagsMatched: number; tagsAssigned: number };
        metadataConflictCount: number;
        outcome: string;
        completed: number;
        failed: number;
        errors: Array<{ item: string; message: string; timestamp: string }>;
        warnings: string[];
        details: {
          playlistId: string;
          videos: number;
          failed: number;
          errors: Array<{ videoId: string; message: string; timestamp: string }>;
        };
        summaries: Array<{ sourceId: string }>;
      };
      expect(summary.sourceId).toBe('youtube');
      expect(summary.playlistId).toBe('test-playlist');
      expect(summary.videos).toBe(2);
      expect(summary.itemCount).toBe(2);
      expect(summary.outcome).toBe('completed');
      expect(summary.completed).toBe(2);
      expect(summary.failed).toBe(0);
      expect(summary.errors).toEqual([]);
      expect(summary.details).toEqual({ playlistId: 'test-playlist', videos: 2, failed: 0, errors: [] });
      expect(summary.classification).toMatchObject({ status: 'disabled', tagsMatched: 0, tagsAssigned: 0 });
      expect(summary.metadataConflictCount).toBe(0);
      expect(summary.warnings).toEqual([]);
      expect(summary.summaries.map(item => item.sourceId)).toEqual(['youtube', 'youtube']);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 60_000);

  it('runs youtube playlist ingestion as a reusable helper', async () => {
    const summary = await runYouTubePlaylistIngest('test-playlist', {
      client: new MockYouTubeClient(),
      services: services(),
    });

    expect(summary.sourceId).toBe('youtube');
    expect(summary.playlistId).toBe('test-playlist');
    expect(summary.itemCount).toBe(2);
    expect(summary.outcome).toBe('completed');
    expect(summary.completed).toBe(2);
    expect(summary.failed).toBe(0);
    expect(summary.errors).toEqual([]);
    expect(summary.details).toEqual({ playlistId: 'test-playlist', videos: 2, failed: 0, errors: [] });
    expect(summary.classification).toMatchObject({ status: 'disabled', tagsMatched: 0, tagsAssigned: 0 });
    expect(summary.metadataConflictCount).toBe(0);
    expect(summary.warnings).toEqual([]);
    expect(summary.summaries).toHaveLength(2);
    expect(summary.summaries[0]?.canonicalId).toBe('youtube-test-video');
    expect(summary.summaries[1]?.canonicalId).toBe('youtube-test-video-2');
  });

  it('reuses resilient playlist ingestion for partial youtube failures', async () => {
    const summary = await runYouTubePlaylistIngest('partial-playlist', {
      client: new MockYouTubeClient(),
      services: taxonomyServices(),
    });

    expect(summary.sourceId).toBe('youtube');
    expect(summary.playlistId).toBe('partial-playlist');
    expect(summary.itemCount).toBe(2);
    expect(summary.outcome).toBe('completed_with_errors');
    expect(summary.completed).toBe(1);
    expect(summary.failed).toBe(1);
    expect(summary.videos).toBe(1);
    expect(summary.summaries).toHaveLength(1);
    expect(summary.summaries[0]?.canonicalId).toBe('youtube-test-video');
    expect(summary.details).toEqual({
      playlistId: 'partial-playlist',
      videos: 1,
      failed: 1,
      errors: [{
        item: 'missing-video',
        message: 'Video not found: missing-video',
        timestamp: '2026-05-25T12:34:56.000Z',
      }],
    });
    expect(summary.errors).toEqual(summary.details.errors);
    expect(summary.warnings).toContain('missing-video: Video not found: missing-video');
  });

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
    expect(summary.itemCount).toBe(1);
    expect(summary.outcome).toBe('completed');
    expect(summary.completed).toBe(1);
    expect(summary.failed).toBe(0);
    expect(summary.errors).toEqual([]);
    expect(summary.totalBooks).toBe(1);
    expect(summary.details).toEqual({ updatedAfter: '2026-05-01T00:00:00Z', totalBooks: 1, errors: [] });
    expect(summary.classification).toMatchObject({ status: 'disabled', tagsMatched: 0, tagsAssigned: 0 });
    expect(summary.metadataConflictCount).toBe(0);
    expect(summary.references.referencesCreated).toBeGreaterThanOrEqual(0);
    expect(summary.warnings).toEqual([]);
    expect(summary.summaries[0]?.canonicalId).toBe('web:https://example.com/article');
    expect(summary.summaries[0]?.segments[0]?.locator).toEqual({ kind: 'external', system: 'readwise', externalId: '1' });
    expectDraftClaims(summary.summaries[0]!);
  });

  it('surfaces partial readwise failures without dropping them from the batch contract', async () => {
    const summary = await runReadwiseIngest(undefined, {
      token: 'token-123',
      context: {
        services: { clock: { now: () => new Date('2026-05-25T12:34:56.000Z') } },
        async runReport(_sourceId, ref) {
          if (ref.includes('/12')) {
            throw new Error('book export failed');
          }
          return reportFor('readwise', ref);
        },
        async runVector(_sourceId: never, ref: string, _vector: ComposedVector) {
          return {
            ...reportFor('readwise', ref),
            ref,
            label: undefined,
            segments: [],
            chunks: [],
          };
        },
      },
      fetchFn: async () => ({
        ok: true,
        status: 200,
        async json() {
          return {
            count: 2,
            nextPageCursor: null,
            results: [
              {
                user_book_id: 11,
                title: 'First',
                author: 'Author',
                readwise_url: 'https://readwise.io/bookreview/11',
                highlights: [{ id: 1, text: 'First quote', book_id: 11, updated_at: '2026-05-22T00:00:00.000Z' }],
              },
              {
                user_book_id: 12,
                title: 'Second',
                author: 'Author',
                readwise_url: 'https://readwise.io/bookreview/12',
                highlights: [{ id: 2, text: 'Second quote', book_id: 12, updated_at: '2026-05-22T00:00:00.000Z' }],
              },
            ],
          };
        },
      }),
    });

    expect(summary.outcome).toBe('completed_with_errors');
    expect(summary.completed).toBe(1);
    expect(summary.failed).toBe(1);
    expect(summary.errors).toEqual([{
      item: 'https://readwise.io/bookreview/12',
      message: 'book export failed',
      timestamp: '2026-05-25T12:34:56.000Z',
    }]);
    expect(summary.details.errors).toEqual(summary.errors);
    expect(summary.references).toMatchObject({ referencesCreated: 1, referenceEdgesCreated: 1 });
    expect(summary.warnings).toContain('https://readwise.io/bookreview/12: book export failed');
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
    expect(summary.itemCount).toBe(1);
    expect(summary.outcome).toBe('completed');
    expect(summary.completed).toBe(1);
    expect(summary.failed).toBe(0);
    expect(summary.errors).toEqual([]);
    expect(summary.threads).toBe(1);
    expect(summary.importedFiles).toBe(2);
    expect(summary.details).toEqual({ importedFiles: 2, threads: 1, errors: [] });
    expect(summary.classification).toMatchObject({ status: 'disabled', tagsMatched: 0, tagsAssigned: 0 });
    expect(summary.metadataConflictCount).toBe(0);
    expect(summary.references.referencesCreated).toBeGreaterThanOrEqual(0);
    expect(summary.warnings).toEqual([]);
    expect(summary.summaries[0]?.canonicalId).toBe('email:thread:msg-a');
    expect(summary.summaries[0]?.segmentCount).toBe(2);
    expectDraftClaims(summary.summaries[0]!);
  }, 60_000);

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

  it('surfaces classification and metadata conflict telemetry in summaries', async () => {
    const summary = await runLinkedInIngest('stdin', {
      pasteText: 'LinkedIn update about resilient ingestion.',
      services: taxonomyServices(),
    });

    expect(summary.classification).toMatchObject({
      status: 'completed',
      tagsMatched: 1,
      tagsAssigned: 1,
    });
    expect(summary.metadataConflictCount).toBe(0);
  });

  it.runIf(SQLiteStore.isAvailable())('persists generic vector taxonomy assignments across fresh CLI service lifetimes', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'aidha-cli-taxonomy-'));
    const dbPath = join(dir, 'aidha.sqlite');
    try {
      const seeded = taxonomyServices();
      const config = { ...seeded.config!, db: dbPath };
      const firstStore = SQLiteStore.open(dbPath);
      let first: Awaited<ReturnType<typeof runLinkedInIngest>>;
      try {
        first = await runLinkedInIngest('stdin', {
          pasteText: 'LinkedIn update about durable ingestion.',
          services: { ...seeded, config, store: firstStore },
        });
      } finally {
        await firstStore.close();
      }

      const secondStore = SQLiteStore.open(dbPath);
      let second: Awaited<ReturnType<typeof runLinkedInIngest>>;
      let resource: Awaited<ReturnType<SQLiteStore['getNode']>>;
      try {
        second = await runLinkedInIngest('stdin', {
          pasteText: 'LinkedIn update about durable ingestion.',
          services: { ...seeded, config, store: secondStore },
        });
        resource = await secondStore.getNode(second.resourceId);
      } finally {
        await secondStore.close();
      }

      expect(first.classification).toMatchObject({ status: 'completed', tagsMatched: 1, tagsAssigned: 1 });
      expect(second.classification).toMatchObject({ status: 'completed', tagsMatched: 1, tagsAssigned: 0 });
      expect(resource.ok).toBe(true);
      if (!resource.ok) throw resource.error;
      expect(resource.value?.metadata?.['taxonomyAssignments']).toEqual([{
        nodeId: second.resourceId,
        tagId: 'tag-1',
        confidence: 0.7,
        source: 'automatic',
        assignedAt: '2026-05-25T12:34:56.000Z',
        assignedBy: 'praecis-keyword-classifier',
      }]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 60_000);

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

  it.runIf(SQLiteStore.isAvailable())('builds generic CLI runtime services with a durable SQLite store', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'aidha-cli-store-'));
    const dbPath = join(dir, 'aidha.sqlite');
    const configPath = join(dir, 'config.yaml');
    await writeFile(
      configPath,
      [
        'config_version: 1',
        'default_profile: default',
        'profiles:',
        '  default:',
        `    db: ${JSON.stringify(dbPath)}`,
        '    llm:',
        '      model: ""',
        '      base_url: ""',
      ].join('\n'),
    );

    const servicesForWeb = await resolveRuntimeServicesForSource('web', { config: configPath });
    try {
      expect(servicesForWeb.store).toBeInstanceOf(SQLiteStore);
      expect(servicesForWeb.config?.db).toBe(dbPath);
    } finally {
      await servicesForWeb.store?.close();
    }
  }, 30_000);
});
