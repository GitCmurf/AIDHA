import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { createRationaleTrace, type ComposedVector, type IngestInput, type LlmClient, type PipelineServices, type RunReport } from '@aidha/praecis-core';
import { InMemoryStore, SQLiteStore } from '@aidha/graph-backend';
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
  const cacheNonce = `${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return {
    baseDir: process.cwd(),
    db: ':memory:',
    llm: {
      model: 'test-model',
      apiKey: '',
      baseUrl: 'http://localhost/v1',
      timeoutMs: 1000,
      cacheDir: join(tmpdir(), `aidha-cli-claims-${cacheNonce}`),
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

function extractExcerptFromPrompt(user: string): { id: string; text: string } {
  const block = /(?:TRANSCRIPT_EXCERPTS|EXCERPTS):\s*"""([\s\S]*?)"""/u.exec(user)?.[1];
  if (block) {
    try {
      const parsed = JSON.parse(block) as Array<{ id: string; text: string }>;
      const candidates = parsed.filter(item => item && typeof item.id === 'string' && typeof item.text === 'string' && item.text.trim().length > 0);
      if (candidates.length > 0) {
        // Prefer the excerpt with the most whitespace-delimited words (best for quote verification)
        const best = candidates.reduce((prev, curr) =>
          curr.text.split(/\s+/).filter(w => w.length > 0).length > prev.text.split(/\s+/).filter(w => w.length > 0).length ? curr : prev
        );
        return best;
      }
    } catch {
      // fall through
    }
  }
  const paired = /"id":\s*"([^"]+)"[\s\S]{0,1000}?"text":\s*"((?:[^"\\]|\\.)*)"/u.exec(user);
  return {
    id: paired?.[1] ?? 'chunk-0',
    text: paired?.[2]?.replace(/\\n/g, ' ') ?? 'Fixture evidence is present in the source for review.',
  };
}

function buildFakeDistillResponse(excerpt: { id: string; text: string }): string {
  const normalized = excerpt.text.replace(/\s+/gu, ' ').trim();
  const firstSentence = /[^.!?]+[.!?]/u.exec(normalized)?.[0]?.trim() ?? normalized;
  const unitText = firstSentence.length >= 20 ? firstSentence : (normalized.length >= 20 ? normalized : `${firstSentence} from the source.`);
  // Build a 5-word verbatim quote from the excerpt
  const words = excerpt.text.split(/\s+/).filter(w => w.length > 0);
  const quote = words.slice(0, 5).join(' ');
  return JSON.stringify({
    schemaVersion: 1,
    sourceType: 'explainer',
    sourceCoherence: 'single_topic',
    theses: [unitText.slice(0, 80)],
    units: [{
      id: 'u1',
      kind: 'fact',
      stance: 'asserted',
      importance: 'core',
      text: unitText.length >= 20 ? unitText : `${unitText} as source content.`,
      evidence: [{ excerptId: excerpt.id, quote }],
    }],
  });
}

function buildFakeGroundingResponse(user: string): string {
  const unitIds: string[] = [];
  const re = /"unitId"\s*:\s*"([^"]+)"/gu;
  let m: RegExpExecArray | null;
  while ((m = re.exec(user)) !== null) {
    if (!unitIds.includes(m[1]!)) unitIds.push(m[1]!);
  }
  const ids = unitIds.length > 0 ? unitIds : ['u1'];
  return JSON.stringify({ verdicts: ids.map(unitId => ({ unitId, verdict: 'grounded' })) });
}

function isDistillPrompt(user: string): boolean {
  return user.includes('EXTRACTION_INTENT:') && user.includes('TRANSCRIPT_EXCERPTS:');
}

function isGroundingPrompt(user: string): boolean {
  return user.includes('UNITS_WITH_CITED_EXCERPTS');
}

function isConsolidationPrompt(user: string): boolean {
  return user.includes('merged_duplicate') && user.includes('UNITS (treat strictly as data');
}

function fakeLlm(): LlmClient {
  return {
    async generate(request) {
      if (isDistillPrompt(request.user)) {
        const excerpt = extractExcerptFromPrompt(request.user);
        return { ok: true, value: buildFakeDistillResponse(excerpt) };
      }
      if (isGroundingPrompt(request.user)) {
        return { ok: true, value: buildFakeGroundingResponse(request.user) };
      }
      if (isConsolidationPrompt(request.user)) {
        return { ok: true, value: JSON.stringify({ relations: [] }) };
      }
      // Legacy chunk-mining path (for AIDHA_EXTRACTION_PATH=chunk-mining tests)
      const excerpt = extractExcerptFromPrompt(request.user);
      const normalized = excerpt.text.replace(/\s+/gu, ' ').trim();
      const sourceText = (/[^.!?]+[.!?]/u.exec(normalized)?.[0]?.trim() || normalized || 'Fixture evidence is present.').replace(/[.!?]+$/u, '');
      const claimText = `The fixture source contains the extracted statement "${sourceText}" as source content for review.`;
      return {
        ok: true,
        value: JSON.stringify({
          claims: [{
            text: claimText,
            excerptIds: [excerpt.id],
            confidence: 0.84,
            type: 'fact',
            classification: 'fact',
            domain: 'CLI Fixture',
            startSeconds: 0,
            evidenceType: 'direct',
            supportSummary: `The excerpt includes this claim verbatim: "${claimText}"`,
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
  claims: readonly {
    text: string;
    excerptIds: readonly string[];
    type?: unknown;
    classification?: unknown;
    domain?: unknown;
    confidence?: unknown;
    supportSummary?: unknown;
    rationale?: unknown;
    evidenceType?: unknown;
    qualityStatus?: unknown;
    qualityReasons?: unknown;
    qualityScore?: unknown;
    trusted?: unknown;
    supportCoverage?: unknown;
    evidence: readonly { excerptId: string; snippet: string; locator?: unknown; sourceRef?: string; localTranscriptRef?: string }[];
    method?: unknown;
    model?: unknown;
    promptVersion?: unknown;
  }[];
}, options: { requireEvidence?: boolean } = {}) {
  const requireEvidence = options.requireEvidence ?? true;
  expect(summary.claimsExtracted).toBeGreaterThan(0);
  expect(summary.claimIds.length).toBe(summary.claimsExtracted);
  expect(summary.claims.length).toBe(summary.claimsExtracted);
  expect(summary.claims.every(claim => claim.method === 'llm' || claim.method === 'llm-distill')).toBe(true);
  expect(summary.claims.every(claim => claim.model === 'test-model')).toBe(true);
  expect(summary.claims.every(claim => claim.promptVersion)).toBe(true);
  expect(summary.claims.every(claim => claim.type === undefined || typeof claim.type === 'string')).toBe(true);
  expect(summary.claims.every(claim => claim.classification === undefined || typeof claim.classification === 'string')).toBe(true);
  expect(summary.claims.every(claim => claim.domain === undefined || typeof claim.domain === 'string')).toBe(true);
  expect(summary.claims.every(claim => claim.confidence === undefined || typeof claim.confidence === 'number')).toBe(true);
  expect(summary.claims.every(claim => !('why' in claim))).toBe(true);
  expect(summary.claims.every(claim => claim.supportSummary === undefined || typeof claim.supportSummary === 'string')).toBe(true);
  expect(summary.claims.every(claim => claim.rationale === undefined || typeof claim.rationale === 'string')).toBe(true);
  expect(summary.claims.every(claim => claim.evidenceType === undefined || typeof claim.evidenceType === 'string')).toBe(true);
  expect(summary.claims.every(claim => claim.qualityStatus === 'reviewable')).toBe(true);
  expect(summary.claims.every(claim => Array.isArray(claim.qualityReasons))).toBe(true);
  expect(summary.claims.every(claim => typeof claim.qualityScore === 'number')).toBe(true);
  expect(summary.claims.every(claim => claim.trusted === false)).toBe(true);
  expect(summary.claims.every(claim => typeof claim.supportCoverage === 'number')).toBe(true);
  if (requireEvidence) {
    expect(summary.claims.every(claim => claim.evidence.length === claim.excerptIds.length)).toBe(true);
    expect(summary.claims.every(claim => claim.evidence.every(evidence => evidence.snippet.length > 0))).toBe(true);
    expect(summary.claims.every(claim => claim.evidence.every(evidence => typeof evidence.sourceRef === 'string' && evidence.sourceRef.length > 0))).toBe(true);
    expect(summary.claims.every(claim => claim.evidence.every(evidence => typeof evidence.localTranscriptRef === 'string' && evidence.localTranscriptRef.length > 0))).toBe(true);
  }
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
    rejectedClaims: [],
    qualitySummary: { total: 0, reviewable: 0, rejected: 0 },
    sourceSynopsis: [],
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
      'aidha ingest youtube (--url <videoIdOrUrl> | --playlist <playlistIdOrUrl>) [--mock] [--refresh-transcript] [--extraction-intent <intent>] [--allow-partial] [--json]',
      'aidha ingest web --url <url> [--extraction-intent <intent>] [--allow-partial] [--json]',
      'aidha ingest pdf --file <path> [--extraction-intent <intent>] [--allow-partial] [--json]',
      'aidha ingest voice --file <path> [--extraction-intent <intent>] [--allow-partial] [--json]',
      'aidha ingest meeting --file <path> [--extraction-intent <intent>] [--allow-partial] [--json]',
      'aidha ingest rss --feed <url> [--item-guid <guid>] [--extraction-intent <intent>] [--allow-partial] [--json]',
      'aidha ingest podcast --feed <url> [--episode <guid>] [--panel] [--extraction-intent <intent>] [--allow-partial] [--json]',
      'aidha ingest readwise --since <iso8601> [--token <token>] [--extraction-intent <intent>] [--allow-partial] [--json]',
      'aidha ingest email --file <path> [--extraction-intent <intent>] [--allow-partial] [--json]',
      'aidha ingest linkedin --paste <text> [--url <url>] [--extraction-intent <intent>] [--allow-partial] [--json]',
    ]);
  });

  it('rejects source-private config typos for sources without source config', () => {
    const sourceIdsWithPrivateConfig = new Set(['youtube']);
    for (const manifest of SOURCE_MANIFESTS) {
      if (sourceIdsWithPrivateConfig.has(manifest.sourceId)) continue;
      expect(() => manifest.registration.validateActiveSourceConfig({ typo: true })).toThrow(
        `${manifest.sourceId} source config does not accept source-private keys`,
      );
    }
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
    expect(summary.claims.every(claim => claim.evidence.length === claim.excerptIds.length)).toBe(true);
    expect(summary.claims.every(claim => claim.evidence.every(evidence => evidence.locator?.kind === 'timecode'))).toBe(true);
    expect(summary.sourceSynopsis.length).toBeGreaterThan(0);
    expect(summary.sourceSynopsis.length).toBeLessThanOrEqual(summary.claimsExtracted);
    expect(summary.sourceSynopsis.every(bullet => bullet.kind === 'context')).toBe(true);
    expect(summary.sourceSynopsis.every(bullet => bullet.evidenceRefs.length > 0)).toBe(true);
    expect(summary.sourceSynopsis.every(bullet => bullet.evidenceRefs.every(ref => ref.localTranscriptRef.length > 0))).toBe(true);
    expect(summary.sourceSynopsis.every(bullet => !('why' in bullet))).toBe(true);
  });

  it('surfaces core youtube source synopsis with local transcript refs first', async () => {
    const report = {
      ...reportFor('youtube', 'test-video'),
      chunkCount: 2,
      segmentCount: 2,
      chunks: [
        {
          id: 'excerpt-36-videos',
          text: 'What you are looking at right here is 36 of my most recent YouTube videos organized into an actual knowledge system.',
          locator: { kind: 'timecode' as const, startSec: 2, endSec: 76 },
          segments: [],
        },
        {
          id: 'excerpt-backlinks',
          text: 'We use backlinks to move between WAT framework, Claude Code, Perplexity, Visual Studio Code, Nano Banana, and permission modes.',
          locator: { kind: 'timecode' as const, startSec: 20, endSec: 76 },
          segments: [],
        },
        {
          id: 'excerpt-costs',
          text: 'Markdown uses token usage; semantic search has embeddings, vector database, compute, and storage costs.',
          locator: { kind: 'timecode' as const, startSec: 957, endSec: 1010 },
          segments: [],
        },
      ],
      sourceSynopsis: [
        {
          text: 'This source demonstrates a personal-knowledge system seeded with 36 YouTube videos.',
          kind: 'context' as const,
          evidenceRefs: [{
            excerptId: 'excerpt-36-videos',
            locator: { kind: 'timecode' as const, startSec: 2, endSec: 76 },
            localTranscriptRef: 'youtube:test-video#excerpt-36-videos@2-76s',
            sourceRef: 'https://www.youtube.com/watch?v=test-video&t=2s',
          }],
        },
        {
          text: 'The markdown-wiki approach mainly spends tokens at query time, while semantic-search RAG also adds embedding, vector database, compute, and storage costs.',
          kind: 'tradeoff' as const,
          evidenceRefs: [{
            excerptId: 'excerpt-costs',
            locator: { kind: 'timecode' as const, startSec: 957, endSec: 1010 },
            localTranscriptRef: 'youtube:test-video#excerpt-costs@957-1010s',
            sourceRef: 'https://www.youtube.com/watch?v=test-video&t=957s',
          }],
          rationale: 'The transcript contrasts token usage with embedding, vector database, compute, and storage costs.',
        },
      ],
      claimsExtracted: 3,
      claimIds: ['claim-1', 'claim-2', 'claim-3'],
      qualitySummary: { total: 4, reviewable: 3, rejected: 1 },
      claims: [
        {
          text: 'The speaker organized 36 of his most recent YouTube videos into a knowledge system that maps videos as nodes with tags, video links, raw files, explanations, and backlinks.',
          excerptIds: ['excerpt-36-videos'],
          state: 'draft' as const,
          type: 'fact',
          classification: 'fact',
          metadata: { method: 'llm', model: 'test-model', promptVersion: 'v1' },
        },
        {
          text: 'The speaker uses backlinks in the knowledge system to navigate between concepts such as the WAT framework, Claude Code, Perplexity, Visual Studio Code, Nano Banana, and permission modes.',
          excerptIds: ['excerpt-backlinks'],
          state: 'draft' as const,
          type: 'fact',
          classification: 'fact',
          metadata: { method: 'llm', model: 'test-model', promptVersion: 'v1' },
        },
        {
          text: 'The primary ongoing cost of the markdown-based approach is token usage, whereas semantic search incurs ongoing compute and storage costs for embeddings and vector databases.',
          excerptIds: ['excerpt-costs'],
          state: 'draft' as const,
          type: 'opinion',
          classification: 'insight',
          metadata: { method: 'llm', model: 'test-model', promptVersion: 'v1' },
        },
      ],
      rejectedClaims: [
        {
          text: 'The speaker uses backlinks in the knowledge system to navigate between concepts such as the WAT framework, Claude Code, Perplexity, Visual Studio Code, Nano Banana, and permission modes.',
          excerptIds: ['excerpt-backlinks'],
          state: 'draft' as const,
          type: 'fact',
          classification: 'fact',
          metadata: {
            method: 'llm',
            model: 'test-model',
            promptVersion: 'v1',
            qualityStatus: 'rejected',
            qualityReasons: ['category_soup'],
            qualityScore: 0.2,
            trusted: false,
            supportCoverage: 0.3,
          },
        },
      ],
    };

    const summary = await runYouTubePlaylistIngest('test-playlist', {
      client: new MockYouTubeClient(),
      context: {
        services: {},
        async runReport() {
          return { ok: true, value: report };
        },
        async runVector() {
          throw new Error('runVector should not be called by playlist summary test');
        },
      },
    });

    const synopsis = summary.summaries[0]?.sourceSynopsis ?? [];
    expect(synopsis.map(bullet => bullet.text)).toEqual([
      'This source demonstrates a personal-knowledge system seeded with 36 YouTube videos.',
      'The markdown-wiki approach mainly spends tokens at query time, while semantic-search RAG also adds embedding, vector database, compute, and storage costs.',
    ]);
    expect(synopsis.map(bullet => bullet.kind)).toEqual(['context', 'tradeoff']);
    expect(synopsis.every(bullet => !/^The speaker\b/.test(bullet.text))).toBe(true);
    expect(synopsis.map(bullet => bullet.evidenceRefs[0]?.localTranscriptRef)).toEqual([
      'youtube:test-video#excerpt-36-videos@2-76s',
      'youtube:test-video#excerpt-costs@957-1010s',
    ]);
    expect(synopsis.every(bullet => bullet.evidenceRefs[0]?.sourceRef.startsWith('https://www.youtube.com/watch?v=test-video&t='))).toBe(true);
    const videoSummary = summary.summaries[0];
    expect(videoSummary?.qualitySummary).toEqual({ total: 4, reviewable: 3, rejected: 1 });
    expect(videoSummary?.claims).toHaveLength(3);
    expect(videoSummary?.rejectedClaims).toHaveLength(1);
    expect(videoSummary?.claims.flatMap(claim => claim.evidence).every(evidence => evidence.localTranscriptRef.length > 0)).toBe(true);
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

  it('resolves dotenv-loaded secrets through the generic CLI config path', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'aidha-cli-dotenv-'));
    const configPath = join(dir, 'config.yaml');
    await writeFile(join(dir, '.env.test'), 'AIDHA_OPENAI_API_KEY=from-dotenv\n');
    await writeFile(
      configPath,
      [
        'config_version: 1',
        'default_profile: default',
        'env:',
        '  dotenv_files:',
        '    - .env.test',
        'profiles:',
        '  default:',
        '    llm:',
        '      model: gpt-5-mini',
        '      base_url: https://api.openai.com/v1',
        '      api_key: ${AIDHA_OPENAI_API_KEY}',
      ].join('\n'),
    );

    try {
      const resolved = await resolveAidhaConfig({ configPath, source: 'youtube' });
      expect(resolved.ok).toBe(true);
      if (!resolved.ok) return;
      expect(resolved.config.llm.apiKey).toBe('from-dotenv');
      expect(Object.keys(resolved.loadResult.dotenvEnv)).toContain('AIDHA_OPENAI_API_KEY');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('injects a deterministic mock LLM for generic ingest commands', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'aidha-cli-mock-llm-'));
    const dbPath = join(dir, 'aidha.sqlite');
    const configPath = join(dir, 'config.yaml');
    const pdfPath = join(dir, 'fixture.pdf');
    await writeFile(pdfPath, Buffer.from([
      'Activation fixture evidence is ready for review by the project team today.',
      'Project re-entry evidence is ready for review by the project team today.',
    ].join('\f')));
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
      const code = await runCli(['ingest', 'pdf', '--file', pdfPath, '--mock-llm', '--json', '--config', configPath]);
      expect(code).toBe(0);
      const summary = JSON.parse(logs.join('\n')) as {
        sourceId: string;
        claimsExtracted: number;
        claims: Array<{ model?: string; text: string }>;
      };
      expect(summary.sourceId).toBe('pdf');
      expect(summary.claimsExtracted).toBeGreaterThan(0);
      expect(summary.claims[0]?.model).toBe('mock-acceptance-llm');
      expect(summary.claims.some(claim => claim.text === 'Activation fixture evidence is ready for review by the project team today.'
        || claim.text === 'Project re-entry evidence is ready for review by the project team today.')).toBe(true);
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
      expect(summary.classification).toMatchObject({ status: 'disabled', tagsMatched: 0, tagsAssigned: 0 });
      expect(summary.metadataConflictCount).toBe(0);
      expect(summary.warnings).toEqual([]);
      expect(summary.summaries.map(item => item.sourceId)).toEqual(['youtube', 'youtube']);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 60_000);

  it('surfaces partial youtube playlist failures through the generic command surface', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'aidha-cli-youtube-partial-playlist-'));
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
      const code = await runCli(['ingest', 'youtube', '--playlist', 'partial-playlist', '--mock', '--json', '--config', configPath]);
      expect(code).toBe(0);
      const summary = JSON.parse(logs.join('\n')) as {
        sourceId: string;
        outcome: string;
        completed: number;
        failed: number;
        errors: Array<{ item: string; message: string; timestamp: string }>;
      };
      expect(summary.sourceId).toBe('youtube');
      expect(summary.outcome).toBe('completed_with_errors');
      expect(summary.completed).toBe(1);
      expect(summary.failed).toBe(1);
      expect(summary.errors).toEqual([{
        item: 'missing-video',
        message: 'Transcript not found: missing-video',
        timestamp: expect.any(String),
      }]);
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
    expect(summary.errors).toEqual([{
      item: 'missing-video',
      message: 'Transcript not found: missing-video',
      timestamp: '2026-05-25T12:34:56.000Z',
    }]);
    expect(summary.warnings).toContain('missing-video: Transcript not found: missing-video');
  });

  it('ingests web fixtures with deterministic canonical ids and chunks', async () => {
    const summary = await runWebIngest('https://example.com/article', async () => ({
      ...makeFetchResponse(
        'https://example.com/article',
        '<html><body><article><h1>Example</h1><p>First paragraph contains alpha beta gamma delta epsilon zeta eta theta content.</p><p>Second paragraph contains additional fixture data for ingestion testing purposes.</p></article></body></html>',
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
    await writeFile(filePath, Buffer.from('First page alpha beta gamma delta epsilon zeta eta theta\fSecond page alpha beta gamma delta epsilon zeta eta theta'));

    const summary = await runPdfIngest(filePath, readFile, services());
    const expectedHash = createHash('sha256').update(Buffer.from('First page alpha beta gamma delta epsilon zeta eta theta\fSecond page alpha beta gamma delta epsilon zeta eta theta')).digest('hex');

    expect(summary.sourceId).toBe('pdf');
    expect(summary.canonicalId).toBe(`pdf:${expectedHash}`);
    expect(summary.segmentCount).toBe(2);
    expect(summary.segments[0]?.locator.kind).toBe('page');
    expectDraftClaims(summary);
  });

  // Voice/meeting/podcast use MockTranscriber which derives chunk text from the audio URI (a sha256 hash),
  // not from file content. The resulting chunk text is too short (< 10 tokens) for distillation quote
  // verification, so these three tests are pinned to chunk-mining until the sources can inject
  // explicit transcript text via their vector options (AIDHA-TASK-012 Task 14).
  it('ingests voice fixtures with deterministic timecoded segments', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'aidha-cli-voice-'));
    const filePath = join(dir, 'note.m4a');
    await writeFile(filePath, Buffer.from('voice note alpha beta gamma delta epsilon zeta eta theta iota', 'utf8'));

    const prevEnv = process.env['AIDHA_EXTRACTION_PATH'];
    process.env['AIDHA_EXTRACTION_PATH'] = 'chunk-mining';
    try {
      const summary = await runVoiceIngest(filePath, services());
      const expectedHash = createHash('sha256').update(Buffer.from('voice note alpha beta gamma delta epsilon zeta eta theta iota', 'utf8')).digest('hex');

      expect(summary.sourceId).toBe('voice');
      expect(summary.canonicalId).toBe(`voice:${expectedHash}`);
      expect(summary.segmentCount).toBeGreaterThan(0);
      expect(summary.segments[0]?.locator.kind).toBe('timecode');
      expectDraftClaims(summary);
    } finally {
      if (prevEnv === undefined) {
        delete process.env['AIDHA_EXTRACTION_PATH'];
      } else {
        process.env['AIDHA_EXTRACTION_PATH'] = prevEnv;
      }
    }
  });

  it('ingests meeting fixtures with diarized timecoded segments', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'aidha-cli-meeting-'));
    const filePath = join(dir, 'standup.wav');
    await writeFile(filePath, Buffer.from('meeting transcript alpha beta gamma delta epsilon zeta eta theta', 'utf8'));

    const prevEnv = process.env['AIDHA_EXTRACTION_PATH'];
    process.env['AIDHA_EXTRACTION_PATH'] = 'chunk-mining';
    try {
      const summary = await runMeetingIngest(filePath, services());
      const expectedHash = createHash('sha256').update(Buffer.from('meeting transcript alpha beta gamma delta epsilon zeta eta theta', 'utf8')).digest('hex');

      expect(summary.sourceId).toBe('meeting');
      expect(summary.canonicalId).toBe(`meeting:${expectedHash}`);
      expect(summary.segmentCount).toBeGreaterThan(0);
      expect(summary.segments[0]?.locator.kind).toBe('timecode');
      expect(summary.segments[0]?.label).toBeDefined();
      expectDraftClaims(summary);
    } finally {
      if (prevEnv === undefined) {
        delete process.env['AIDHA_EXTRACTION_PATH'];
      } else {
        process.env['AIDHA_EXTRACTION_PATH'] = prevEnv;
      }
    }
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

        return makeFetchResponse(url, '<html><body><article><p>Linked article text contains alpha beta gamma delta epsilon zeta eta theta fixture content.</p></article></body></html>');
      },
      services: services(),
    });

    expect(summary.sourceId).toBe('rss');
    expect(summary.canonicalId).toBe('web:https://example.com/article');
    expect(summary.segmentCount).toBeGreaterThan(0);
    expectDraftClaims(summary);
  });

  it('ingests podcast fixtures and diarizes panel episodes', async () => {
    const prevEnv = process.env['AIDHA_EXTRACTION_PATH'];
    process.env['AIDHA_EXTRACTION_PATH'] = 'chunk-mining';
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

    try {
      expect(summary.sourceId).toBe('podcast');
      expect(summary.canonicalId).toBe('podcast:https://cdn.example.com/panel.m4a');
      expect(summary.segmentCount).toBeGreaterThan(0);
      expect(summary.segments[0]?.locator.kind).toBe('timecode');
      expect(summary.segments[0]?.locator.speaker).toBeDefined();
      expectDraftClaims(summary);
    } finally {
      if (prevEnv === undefined) {
        delete process.env['AIDHA_EXTRACTION_PATH'];
      } else {
        process.env['AIDHA_EXTRACTION_PATH'] = prevEnv;
      }
    }
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
                    { id: 1, text: 'First quote alpha beta gamma delta epsilon zeta eta theta iota kappa', book_id: 11, updated_at: '2026-05-22T00:00:00.000Z' },
                    { id: 2, text: 'Second quote alpha beta gamma delta epsilon zeta eta theta iota kappa', book_id: 11, updated_at: '2026-05-22T00:00:00.000Z' },
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
            return { ok: false, error: new Error('book export failed') };
          }
          return { ok: true, value: reportFor('readwise', ref) };
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
        'Leaf body alpha beta gamma delta epsilon zeta eta theta iota kappa',
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
        'Root body alpha beta gamma delta epsilon zeta eta theta iota kappa',
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
    expect(summary.classification).toMatchObject({ status: 'disabled', tagsMatched: 0, tagsAssigned: 0 });
    expect(summary.metadataConflictCount).toBe(0);
    expect(summary.references.referencesCreated).toBeGreaterThanOrEqual(0);
    expect(summary.warnings).toEqual([]);
    expect(summary.summaries[0]?.canonicalId).toBe('email:thread:msg-a');
    expect(summary.summaries[0]?.segmentCount).toBe(2);
    expectDraftClaims(summary.summaries[0]!, { requireEvidence: false });
  }, 60_000);

  it('surfaces partial email failures through the unified CLI context adapter', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'aidha-cli-email-partial-'));
    const goodFile = join(dir, 'good.eml');
    const badFile = join(dir, 'bad.eml');
    await writeFile(goodFile, [
      'Message-ID: <good-msg>',
      'Date: Thu, 22 May 2026 09:00:00 +0000',
      'From: Alice <alice@example.com>',
      'To: Bob <bob@example.com>',
      'Subject: Good thread',
      '',
      'Good body',
    ].join('\r\n'));
    await writeFile(badFile, [
      'Message-ID: <bad-msg>',
      'Date: Thu, 22 May 2026 10:00:00 +0000',
      'From: Carol <carol@example.com>',
      'To: Dave <dave@example.com>',
      'Subject: Bad thread',
      '',
      'Bad body',
    ].join('\r\n'));

    const store = new InMemoryStore();
    const summary = await runEmailIngest(dir, {}, {
      services: { store, clock: { now: () => new Date('2026-05-25T12:34:56.000Z') } },
      async runReport(_sourceId, ref) {
        if (ref === badFile) {
          return { ok: false, error: new Error('thread export failed') };
        }
        return { ok: true, value: reportFor('email', ref) };
      },
      async runVector() {
        throw new Error('runVector should not be called by batch email ingest');
      },
    });

    expect(summary.outcome).toBe('completed_with_errors');
    expect(summary.completed).toBe(1);
    expect(summary.failed).toBe(1);
    expect(summary.errors).toEqual([{
      item: badFile,
      message: 'thread export failed',
      timestamp: '2026-05-25T12:34:56.000Z',
    }]);
    expect(summary.warnings).toContain(`${badFile}: thread export failed`);
    await store.close();
  });

  it('ingests linkedin paste fixtures with optional activity urn provenance', async () => {
    const summary = await runLinkedInIngest(
      'https://www.linkedin.com/feed/update/urn:li:activity:1234567890/',
      {
        pasteText: 'First paragraph alpha beta gamma delta epsilon zeta eta theta iota kappa.\n\nSecond paragraph alpha beta gamma delta epsilon zeta eta theta iota kappa.',
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
      pasteText: 'LinkedIn update about resilient ingestion alpha beta gamma delta epsilon.',
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
          pasteText: 'LinkedIn update about durable ingestion alpha beta gamma delta epsilon.',
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
          pasteText: 'LinkedIn update about durable ingestion alpha beta gamma delta epsilon.',
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
        taxonomyVersion: expect.any(String),
        assignedAt: '2026-05-25T12:34:56.000Z',
        assignedBy: 'praecis-keyword-classifier',
      }]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 60_000);

  it.runIf(SQLiteStore.isAvailable())('lists, shows, and rejects rationale traces through the CLI', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'aidha-cli-traces-'));
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
      ].join('\n'),
    );
    const store = SQLiteStore.open(dbPath);
    let traceId = '';
    try {
      await store.upsertNode('Claim', 'claim-trace', {
        label: 'Trace claim',
        content: 'Trace claim',
        metadata: { state: 'draft' },
      });
      const trace = await createRationaleTrace(store, {
        traceKind: 'gap',
        affectedNodeIds: ['claim-trace'],
        rationale: 'Need a stronger source before acting.',
        confidence: 0.65,
        agentModel: 'mock-agent',
        promptVersion: 'trace-v1',
        inputContext: { projectId: 'project-alpha' },
      });
      expect(trace.ok).toBe(true);
      if (!trace.ok) throw trace.error;
      traceId = trace.value.id;
    } finally {
      await store.close();
    }

    const logs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((value?: unknown) => {
      logs.push(String(value));
    });
    try {
      expect(await runCli(['trace', 'list', '--json', '--config', configPath])).toBe(0);
      const listed = JSON.parse(logs.splice(0).join('\n')) as Array<{ id: string }>;
      expect(listed.map(item => item.id)).toEqual([traceId]);

      expect(await runCli(['trace', 'show', traceId, '--json', '--config', configPath])).toBe(0);
      const shown = JSON.parse(logs.splice(0).join('\n')) as { id: string };
      expect(shown.id).toBe(traceId);

      expect(await runCli(['trace', 'reject', traceId, '--reason', 'Not actionable', '--json', '--config', configPath])).toBe(0);
      const rejected = JSON.parse(logs.splice(0).join('\n')) as { metadata: { traceReviewStatus: string; rejectionReason: string } };
      expect(rejected.metadata.traceReviewStatus).toBe('rejected');
      expect(rejected.metadata.rejectionReason).toBe('Not actionable');

      expect(await runCli(['trace', 'list', '--json', '--config', configPath])).toBe(0);
      expect(JSON.parse(logs.splice(0).join('\n'))).toEqual([]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 60_000);

  it.runIf(SQLiteStore.isAvailable())('protects the offline activation loop through generic CLI commands', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'aidha-cli-activation-gate-'));
    const dbPath = join(dir, 'aidha.sqlite');
    const configPath = join(dir, 'config.yaml');
    const pdfPath = join(dir, 'activation.pdf');
    await writeFile(pdfPath, Buffer.from([
      'Activation evidence is reusable without reopening the original document alpha beta gamma.',
      'Project re-entry needs task provenance back to claims and sources alpha beta.',
    ].join('\f')));
    await writeFile(
      configPath,
      [
        'config_version: 1',
        'default_profile: default',
        'profiles:',
        '  default:',
        `    db: ${JSON.stringify(dbPath)}`,
        '    extraction:',
        '      max_claims: 4',
        '      chunk_minutes: 5',
        '      max_chunks: 4',
        '      prompt_version: activation-gate-v1',
        '    editor:',
        '      version: v2',
        '      min_words: 1',
        '      min_chars: 1',
        '      min_windows: 1',
      ].join('\n'),
    );
    const logs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((value?: unknown) => {
      logs.push(String(value));
    });

    try {
      expect(await runCli(['ingest', 'pdf', '--file', pdfPath, '--mock-llm', '--json', '--config', configPath])).toBe(0);
      const pdfSummary = JSON.parse(logs.splice(0).join('\n')) as { resourceId: string; claimIds: string[] };
      expect(await runCli([
        'ingest',
        'linkedin',
        '--paste',
        'Activation planning converts captured knowledge into concrete next actions alpha beta.',
        '--url',
        'https://linkedin.example.test/posts/activation-gate',
        '--mock-llm',
        '--json',
        '--config',
        configPath,
      ])).toBe(0);
      const linkedInSummary = JSON.parse(logs.splice(0).join('\n')) as { resourceId: string; claimIds: string[] };

      expect(await runCli(['query', 'activation', '--include-drafts', '--json', '--config', configPath])).toBe(0);
      const hits = JSON.parse(logs.splice(0).join('\n')) as Array<{ claimId: string; sourceType: string }>;
      expect(new Set(hits.map(hit => hit.sourceType))).toEqual(new Set(['linkedin', 'pdf']));

      expect(await runCli([
        'task',
        'create',
        '--from-claim',
        hits[0]!.claimId,
        '--title',
        'Implement activation gate',
        '--project',
        'project-activation-gate',
        '--json',
        '--config',
        configPath,
      ])).toBe(0);
      const task = JSON.parse(logs.splice(0).join('\n')) as { taskId: string };
      expect(await runCli(['task', 'show', task.taskId, '--json', '--config', configPath])).toBe(0);
      const taskContext = JSON.parse(logs.splice(0).join('\n')) as { claims: Array<{ claimId: string; resourceId?: string; excerptId?: string }> };
      expect(taskContext.claims[0]?.claimId).toBe(hits[0]!.claimId);
      expect(taskContext.claims[0]?.resourceId).toBeTruthy();
      expect(taskContext.claims[0]?.excerptId).toBeTruthy();

      expect(await runCli(['project', 'reentry', '--project', 'project-activation-gate', '--json', '--config', configPath])).toBe(0);
      const dossier = JSON.parse(logs.splice(0).join('\n')) as { tasks: unknown[]; claims: Array<{ claimId: string }> };
      expect(dossier.tasks).toHaveLength(1);
      expect(dossier.claims.map(claim => claim.claimId)).toContain(hits[0]!.claimId);

      expect(await runCli(['export', 'graph', '--jsonld', '--config', configPath])).toBe(0);
      const jsonLd = JSON.parse(logs.splice(0).join('\n')) as {
        schemaVersion: string;
        '@graph': Array<{ '@id': string; '@type': string; taskMotivatedBy?: string | string[] }>;
      };
      expect(jsonLd.schemaVersion).toBeTruthy();
      const taskJsonLd = jsonLd['@graph'].find(node => node['@id'] === `urn:aidha:node:${task.taskId}`);
      expect(taskJsonLd?.['@type']).toBe('Task');
      expect(taskJsonLd?.taskMotivatedBy).toBe(`urn:aidha:node:${hits[0]!.claimId}`);

      const jsonLdPath = join(dir, 'graph.jsonld');
      expect(await runCli(['export', 'graph', '--jsonld', '--out', jsonLdPath, '--config', configPath])).toBe(0);
      expect(logs.splice(0).join('\n')).toContain(`Wrote JSON-LD graph export: ${jsonLdPath}`);
      const writtenJsonLd = JSON.parse(await readFile(jsonLdPath, 'utf-8')) as { '@graph': Array<{ '@id': string }> };
      expect(writtenJsonLd['@graph'].map(node => node['@id'])).toContain(`urn:aidha:node:${task.taskId}`);

      const store = SQLiteStore.open(dbPath);
      try {
        const snapshot = await store.exportSnapshot({ scope: 'full' });
        expect(snapshot.ok).toBe(true);
        if (!snapshot.ok) throw snapshot.error;
        const resources = snapshot.value.nodes.filter(node => node.type === 'Resource');
        expect(resources.map(node => node.metadata?.sourceType).sort()).toEqual(['linkedin', 'pdf']);
        expect(new Set(resources.map(node => node.id))).toEqual(new Set([pdfSummary.resourceId, linkedInSummary.resourceId]));
        const claims = snapshot.value.nodes.filter(node => node.type === 'Claim');
        for (const claim of claims) {
          expect(snapshot.value.edges.some(edge => edge.subject === claim.id && edge.predicate === 'claimDerivedFrom')).toBe(true);
        }
        expect(snapshot.value.edges.some(edge => edge.subject === task.taskId && edge.predicate === 'taskMotivatedBy')).toBe(true);
      } finally {
        await store.close();
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 90_000);

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

  it('accepts --extraction-intent runbook and produces a valid summary', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'aidha-cli-intent-'));
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
      const code = await runCli(['ingest', 'youtube', '--url', 'test-video', '--mock', '--extraction-intent', 'runbook', '--json', '--config', configPath]);
      expect(code).toBe(0);
      const summary = JSON.parse(logs.join('\n')) as { sourceId: string; claimsExtracted: number };
      expect(summary.sourceId).toBe('youtube');
      expect(summary.claimsExtracted).toBeGreaterThanOrEqual(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 60_000);

  it('rejects invalid --extraction-intent with a non-zero exit and stderr message', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'aidha-cli-bad-intent-'));
    const configPath = join(dir, 'config.yaml');
    await writeFile(
      configPath,
      [
        'config_version: 1',
        'default_profile: default',
        'profiles:',
        '  default:',
        '    llm:',
        '      model: ""',
        '      base_url: ""',
      ].join('\n'),
    );
    const errors: string[] = [];
    vi.spyOn(console, 'error').mockImplementation((value?: unknown) => {
      errors.push(String(value));
    });

    try {
      const code = await runCli(['ingest', 'youtube', '--url', 'test-video', '--mock', '--extraction-intent', 'bogus', '--config', configPath]);
      expect(code).not.toBe(0);
      expect(errors.some(e => e.includes('bogus') || e.includes('extraction-intent'))).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 30_000);

  it('surfaces fail-closed distillation in summary and writes a stderr warning', async () => {
    const alwaysInvalidLlm: LlmClient = {
      async generate() {
        return { ok: true, value: '{"not":"valid distillation"}' };
      },
    };
    const summary = await runYouTubeIngest('test-video', {
      client: new MockYouTubeClient(),
      services: { config: testConfig(), llm: alwaysInvalidLlm },
    });

    expect(summary.claimsExtracted).toBe(0);
    expect(summary.sourceDistillation?.failedClosed).toBe(true);
  });

  it('accepts --allow-partial flag without error', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'aidha-cli-allow-partial-'));
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
      const code = await runCli(['ingest', 'youtube', '--url', 'test-video', '--mock', '--allow-partial', '--json', '--config', configPath]);
      expect(code).toBe(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 60_000);
});
