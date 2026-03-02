import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import type { GraphNode } from '@aidha/graph-backend';
import type { Result } from '../pipeline/types.js';
import type { ClaimCandidate, ClaimExtractionInput, ClaimExtractor } from './types.js';
import { HeuristicClaimExtractor } from './claims.js';
import { runEditorPassV1, runEditorPassV2 } from './editorial-ranking.js';
import type { LlmClient } from './llm-client.js';
import { clamp, normalizeText, toNumber } from './utils.js';
import { hashId } from '../utils/ids.js';

const CLAIM_TYPES = [
  'insight',
  'instruction',
  'fact',
  'mechanism',
  'opinion',
  'decision',
  'warning',
  'question',
  'summary',
  'example',
];

const ClaimSchema = z.object({
  text: z.string().min(1),
  excerptIds: z.array(z.string()).min(1),
  startSeconds: z.number().nonnegative().optional(),
  type: z.string().optional(),
  classification: z.string().optional(),
  domain: z.string().optional(),
  confidence: z.number().min(0).max(1).optional(),
  why: z.string().optional(),
});

const ResponseSchema = z.object({
  claims: z.array(ClaimSchema),
});

const CacheMetadataSchema = z.object({
  transcriptHash: z.string().min(1),
  model: z.string().min(1),
  promptVersion: z.string().min(1),
  chunkIndex: z.number().int().nonnegative(),
  chunkStart: z.number().nonnegative(),
  chunkEnd: z.number().nonnegative(),
});

const CacheSchema = z.object({
  metadata: CacheMetadataSchema,
  claims: z.array(ClaimSchema),
});

const RewriteClaimSchema = z.object({
  index: z.number().int().nonnegative(),
  text: z.string().min(1),
});

const RewriteResponseSchema = z.object({
  claims: z.array(RewriteClaimSchema),
});

const RewriteCacheMetadataSchema = z.object({
  transcriptHash: z.string().min(1),
  candidateSetHash: z.string().min(1),
  model: z.string().min(1),
  promptVersion: z.string().min(1),
});

const RewriteCacheSchema = z.object({
  metadata: RewriteCacheMetadataSchema,
  claims: z.array(RewriteClaimSchema),
});

interface ClaimChunk {
  index: number;
  start: number;
  end: number;
  excerpts: GraphNode[];
}

type CacheMetadata = z.infer<typeof CacheMetadataSchema>;
type RewriteCacheMetadata = z.infer<typeof RewriteCacheMetadataSchema>;

export interface LlmClaimExtractorConfig {
  client: LlmClient;
  model: string;
  promptVersion: string;
  chunkMinutes?: number;
  maxChunks?: number;
  maxClaims?: number;
  cacheDir?: string;
  editorVersion?: 'v1' | 'v2';
  editorWindowMinutes?: number;
  editorMaxPerWindow?: number;
  editorMinWindows?: number;
  editorMinWords?: number;
  editorMinChars?: number;
  editorLlm?: boolean;
  editorRewritePromptVersion?: string;
  editorRewriteMinKeywordOverlap?: number;
  editorRewriteMaxEditRatio?: number;
  reasoningEffort?: string;
  verbosity?: string;
  fallback?: ClaimExtractor;
}

export interface CachedClaimsLoadOptions {
  resource: GraphNode;
  excerpts: GraphNode[];
  model: string;
  promptVersion: string;
  chunkMinutes?: number;
  maxChunks?: number;
  cacheDir?: string;
}

export interface CachedClaimsLoadResult {
  transcriptHash: string;
  chunkCount: number;
  cacheHits: number;
  cacheMisses: number;
  candidates: ClaimCandidate[];
}

const DEFAULT_CHUNK_MINUTES = 10;
const DEFAULT_MAX_CLAIMS = 25;
const DEFAULT_CACHE_DIR = './out/cache/claims';
const DEFAULT_MIN_CLAIMS_PER_CHUNK = 5;
const DEFAULT_MAX_CLAIMS_PER_CHUNK = 12;
const DEFAULT_EDITOR_REWRITE_PROMPT_VERSION = 'editor-rewrite-v2';
const DEFAULT_EDITOR_REWRITE_MIN_KEYWORD_OVERLAP = 0.3;
const DEFAULT_EDITOR_REWRITE_MAX_EDIT_RATIO = 0.5;

function hashTranscript(excerpts: GraphNode[]): string {
  const hash = createHash('sha256');
  const sorted = excerpts.slice().sort((a, b) => {
    const aStart = toNumber(a.metadata?.['start'], 0);
    const bStart = toNumber(b.metadata?.['start'], 0);
    if (aStart !== bStart) return aStart - bStart;
    return a.id.localeCompare(b.id);
  });
  for (const excerpt of sorted) {
    hash.update(excerpt.id);
    hash.update(String(toNumber(excerpt.metadata?.['start'], 0)));
    hash.update(excerpt.content ?? '');
  }
  return hash.digest('hex').slice(0, 16);
}

function buildChunks(excerpts: GraphNode[], chunkMinutes: number, maxChunks?: number): ClaimChunk[] {
  const sorted = excerpts.slice().sort((a, b) => {
    const aStart = toNumber(a.metadata?.['start'], 0);
    const bStart = toNumber(b.metadata?.['start'], 0);
    if (aStart !== bStart) return aStart - bStart;
    return a.id.localeCompare(b.id);
  });
  if (sorted.length === 0) return [];

  const chunkSeconds = Math.max(60, Math.floor(chunkMinutes * 60));
  const chunks: ClaimChunk[] = [];
  let current: ClaimChunk | null = null;

  for (const excerpt of sorted) {
    const start = toNumber(excerpt.metadata?.['start'], 0);
    if (!current) {
      current = {
        index: 0,
        start,
        end: start,
        excerpts: [],
      };
    }

    if (
      start - current.start >= chunkSeconds &&
      (!maxChunks || chunks.length < maxChunks - 1)
    ) {
      chunks.push(current);
      current = {
        index: chunks.length,
        start,
        end: start,
        excerpts: [],
      };
    }

    current.excerpts.push(excerpt);
    current.end = Math.max(current.end, start);
  }

  if (current) {
    chunks.push(current);
  }

  return chunks;
}

function extractJsonBlock(text: string): string | null {
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenceMatch && typeof fenceMatch[1] === 'string' ? fenceMatch[1] : text;
  const first = candidate.indexOf('{');
  const last = candidate.lastIndexOf('}');
  if (first === -1 || last === -1 || last <= first) return null;
  return candidate.slice(first, last + 1);
}

function normalizeType(value?: string): string | undefined {
  if (!value) return undefined;
  const normalized = value.trim().toLowerCase();
  if (CLAIM_TYPES.includes(normalized)) return normalized;
  return normalized.length > 0 ? normalized : undefined;
}

async function readCache(path: string, metadata: CacheMetadata): Promise<ClaimCandidate[] | null> {
  try {
    const raw = await readFile(path, 'utf-8');
    const parsed = CacheSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) return null;
    const cachedMeta = parsed.data.metadata;
    if (
      cachedMeta.transcriptHash !== metadata.transcriptHash ||
      cachedMeta.model !== metadata.model ||
      cachedMeta.promptVersion !== metadata.promptVersion ||
      cachedMeta.chunkIndex !== metadata.chunkIndex ||
      cachedMeta.chunkStart !== metadata.chunkStart ||
      cachedMeta.chunkEnd !== metadata.chunkEnd
    ) {
      return null;
    }
    return parsed.data.claims;
  } catch {
    return null;
  }
}

async function writeCache(path: string, metadata: CacheMetadata, claims: ClaimCandidate[]): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const payload = {
    metadata,
    claims: claims.map(claim => ({
      text: claim.text,
      excerptIds: claim.excerptIds,
      startSeconds: claim.startSeconds,
      type: claim.type,
      classification: claim.classification,
      domain: claim.domain,
      confidence: claim.confidence,
      why: claim.why,
    })),
  };
  await writeFile(path, JSON.stringify(payload, null, 2), 'utf-8');
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .map(token => token.trim())
    .filter(Boolean);
}

function numericTokens(text: string): string[] {
  return (text.match(/\d+(?:\.\d+)?/g) ?? []).map(token => token.trim());
}

function keywordOverlapRatio(rewrittenText: string, sourceTexts: string[]): number {
  const rewrittenTokens = new Set(tokenize(rewrittenText));
  if (rewrittenTokens.size === 0) return 0;
  const sourceTokenSet = new Set(sourceTexts.flatMap(text => tokenize(text)));
  if (sourceTokenSet.size === 0) return 0;
  let overlap = 0;
  for (const token of rewrittenTokens) {
    if (sourceTokenSet.has(token)) overlap += 1;
  }
  return overlap / rewrittenTokens.size;
}

function editRatio(originalText: string, rewrittenText: string): number {
  const originalTokens = tokenize(originalText);
  const rewrittenTokens = tokenize(rewrittenText);
  const maxLength = Math.max(1, Math.max(originalTokens.length, rewrittenTokens.length));
  const minLength = Math.min(originalTokens.length, rewrittenTokens.length);
  let equal = 0;
  for (let index = 0; index < minLength; index++) {
    if (originalTokens[index] === rewrittenTokens[index]) {
      equal += 1;
    }
  }
  return 1 - (equal / maxLength);
}

function hasNumericTokenLoss(originalText: string, rewrittenText: string): boolean {
  const original = new Set(numericTokens(originalText));
  if (original.size === 0) return false;
  const rewritten = new Set(numericTokens(rewrittenText));
  for (const token of original) {
    if (!rewritten.has(token)) return true;
  }
  return false;
}

function candidateSetHash(candidates: ClaimCandidate[]): string {
  const hash = createHash('sha256');
  const sorted = candidates
    .slice()
    .sort((left, right) => {
      const leftStart = typeof left.startSeconds === 'number' ? left.startSeconds : Number.MAX_SAFE_INTEGER;
      const rightStart = typeof right.startSeconds === 'number' ? right.startSeconds : Number.MAX_SAFE_INTEGER;
      if (leftStart !== rightStart) return leftStart - rightStart;
      const textDiff = left.text.localeCompare(right.text);
      if (textDiff !== 0) return textDiff;
      const leftExcerptKey = Array.from(new Set(left.excerptIds)).sort((a, b) => a.localeCompare(b)).join('|');
      const rightExcerptKey = Array.from(new Set(right.excerptIds)).sort((a, b) => a.localeCompare(b)).join('|');
      return leftExcerptKey.localeCompare(rightExcerptKey);
    });
  for (const candidate of sorted) {
    hash.update(normalizeText(candidate.text));
    hash.update(String(candidate.startSeconds ?? -1));
    hash.update(Array.from(new Set(candidate.excerptIds)).sort((a, b) => a.localeCompare(b)).join('|'));
  }
  return hash.digest('hex').slice(0, 16);
}

async function readRewriteCache(
  path: string,
  metadata: RewriteCacheMetadata
): Promise<Array<{ index: number; text: string }> | null> {
  try {
    const raw = await readFile(path, 'utf-8');
    const parsed = RewriteCacheSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) return null;
    const cachedMeta = parsed.data.metadata;
    if (
      cachedMeta.transcriptHash !== metadata.transcriptHash ||
      cachedMeta.candidateSetHash !== metadata.candidateSetHash ||
      cachedMeta.model !== metadata.model ||
      cachedMeta.promptVersion !== metadata.promptVersion
    ) {
      return null;
    }
    return parsed.data.claims;
  } catch {
    return null;
  }
}

async function writeRewriteCache(
  path: string,
  metadata: RewriteCacheMetadata,
  claims: Array<{ index: number; text: string }>
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify({ metadata, claims }, null, 2), 'utf-8');
}

function cacheKeyForChunk(input: {
  videoId: string;
  chunk: ClaimChunk;
  transcriptHash: string;
  model: string;
  promptVersion: string;
}): string {
  return hashId('llm-claims', [
    input.videoId,
    input.chunk.index,
    input.chunk.start,
    input.chunk.end,
    input.transcriptHash,
    input.model,
    input.promptVersion,
  ]);
}

function cacheMetadataForChunk(input: {
  transcriptHash: string;
  model: string;
  promptVersion: string;
  chunk: ClaimChunk;
}): CacheMetadata {
  return {
    transcriptHash: input.transcriptHash,
    model: input.model,
    promptVersion: input.promptVersion,
    chunkIndex: input.chunk.index,
    chunkStart: input.chunk.start,
    chunkEnd: input.chunk.end,
  };
}

export async function loadCachedClaimCandidates(
  input: CachedClaimsLoadOptions
): Promise<CachedClaimsLoadResult> {
  const chunkMinutes = input.chunkMinutes ?? DEFAULT_CHUNK_MINUTES;
  const cacheDir = input.cacheDir ?? DEFAULT_CACHE_DIR;
  const transcriptHash = hashTranscript(input.excerpts);
  const chunked = buildChunks(input.excerpts, chunkMinutes, input.maxChunks);
  const videoId = typeof input.resource.metadata?.['videoId'] === 'string'
    ? (input.resource.metadata?.['videoId'] as string)
    : input.resource.id;

  const candidates: ClaimCandidate[] = [];
  let cacheHits = 0;
  let cacheMisses = 0;

  for (const chunk of chunked) {
    const cacheKey = cacheKeyForChunk({
      videoId,
      chunk,
      transcriptHash,
      model: input.model,
      promptVersion: input.promptVersion,
    });
    const cachePath = join(cacheDir, `${cacheKey}.json`);
    const metadata = cacheMetadataForChunk({
      transcriptHash,
      model: input.model,
      promptVersion: input.promptVersion,
      chunk,
    });
    const cached = await readCache(cachePath, metadata);
    if (!cached) {
      cacheMisses += 1;
      continue;
    }
    cacheHits += 1;
    candidates.push(
      ...cached.map(claim => ({
        ...claim,
        method: 'llm' as const,
        model: input.model,
        promptVersion: input.promptVersion,
        chunkIndex: chunk.index,
      }))
    );
  }

  return {
    transcriptHash,
    chunkCount: chunked.length,
    cacheHits,
    cacheMisses,
    candidates,
  };
}

export class LlmClaimExtractor implements ClaimExtractor {
  private client: LlmClient;
  private model: string;
  private promptVersion: string;
  private chunkMinutes: number;
  private maxChunks?: number;
  private maxClaims: number;
  private cacheDir: string;
  private editorVersion: 'v1' | 'v2';
  private editorWindowMinutes?: number;
  private editorMaxPerWindow?: number;
  private editorMinWindows?: number;
  private editorMinWords?: number;
  private editorMinChars?: number;
  private editorLlm: boolean;
  private editorRewritePromptVersion: string;
  private editorRewriteMinKeywordOverlap: number;
  private editorRewriteMaxEditRatio: number;
  private reasoningEffort?: string;
  private verbosity?: string;
  private fallback?: ClaimExtractor;

  constructor(config: LlmClaimExtractorConfig) {
    this.client = config.client;
    this.model = config.model;
    this.promptVersion = config.promptVersion;
    this.chunkMinutes = config.chunkMinutes ?? DEFAULT_CHUNK_MINUTES;
    this.maxChunks = config.maxChunks;
    this.maxClaims = config.maxClaims ?? DEFAULT_MAX_CLAIMS;
    this.cacheDir = config.cacheDir ?? DEFAULT_CACHE_DIR;
    this.editorVersion = config.editorVersion ?? 'v1';
    this.editorWindowMinutes = config.editorWindowMinutes;
    this.editorMaxPerWindow = config.editorMaxPerWindow;
    this.editorMinWindows = config.editorMinWindows;
    this.editorMinWords = config.editorMinWords;
    this.editorMinChars = config.editorMinChars;
    this.editorLlm = config.editorLlm ?? false;
    this.editorRewritePromptVersion =
      config.editorRewritePromptVersion ?? DEFAULT_EDITOR_REWRITE_PROMPT_VERSION;
    this.editorRewriteMinKeywordOverlap = clamp(
      config.editorRewriteMinKeywordOverlap ?? DEFAULT_EDITOR_REWRITE_MIN_KEYWORD_OVERLAP,
      0,
      1
    );
    this.editorRewriteMaxEditRatio = clamp(
      config.editorRewriteMaxEditRatio ?? DEFAULT_EDITOR_REWRITE_MAX_EDIT_RATIO,
      0,
      1
    );
    this.reasoningEffort = config.reasoningEffort;
    this.verbosity = config.verbosity;
    this.fallback = config.fallback ?? new HeuristicClaimExtractor();
  }

  getEditorVersion(): 'v1' | 'v2' {
    return this.editorVersion;
  }

  async extractClaims(input: ClaimExtractionInput): Promise<ClaimCandidate[]> {
    const maxClaims = input.maxClaims ?? this.maxClaims;
    const excerpts = input.excerpts;
    const resource = input.resource;
    const chunked = buildChunks(excerpts, this.chunkMinutes, this.maxChunks);
    const transcriptHash = hashTranscript(excerpts);

    const excerptStartMap = new Map<string, number>();
    for (const excerpt of excerpts) {
      excerptStartMap.set(excerpt.id, toNumber(excerpt.metadata?.['start'], 0));
    }

    const allCandidates: ClaimCandidate[] = [];

    for (const chunk of chunked) {
      const chunkCandidates = await this.extractChunkClaims({
        resource,
        chunk,
        transcriptHash,
        excerptStartMap,
        chunkCount: chunked.length,
      });
      allCandidates.push(...chunkCandidates);
    }

    let selected: ClaimCandidate[];
    if (this.editorVersion === 'v2') {
      const excerptTextLengthById = new Map<string, number>();
      for (const excerpt of excerpts) {
        excerptTextLengthById.set(excerpt.id, excerpt.content?.length ?? 0);
      }
      selected = runEditorPassV2(allCandidates, {
        maxClaims,
        chunkCount: chunked.length,
        windowMinutes: this.editorWindowMinutes,
        maxPerWindow: this.editorMaxPerWindow,
        minWindows: this.editorMinWindows,
        minWords: this.editorMinWords,
        minChars: this.editorMinChars,
        excerptTextLengthById,
      });
    } else {
      selected = runEditorPassV1(allCandidates, {
        maxClaims,
        chunkCount: chunked.length,
      });
    }

    if (this.editorLlm && selected.length > 0) {
      return this.rewriteSelectedClaims({
        resource,
        excerpts,
        transcriptHash,
        selected,
      });
    }

    return selected;
  }

  private async rewriteSelectedClaims(input: {
    resource: GraphNode;
    excerpts: GraphNode[];
    transcriptHash: string;
    selected: ClaimCandidate[];
  }): Promise<ClaimCandidate[]> {
    const { resource, excerpts, transcriptHash, selected } = input;
    const videoId = typeof resource.metadata?.['videoId'] === 'string'
      ? (resource.metadata?.['videoId'] as string)
      : resource.id;
    const setHash = candidateSetHash(selected);
    const cacheKey = hashId('llm-editor-rewrite', [
      videoId,
      transcriptHash,
      setHash,
      this.model,
      this.editorRewritePromptVersion,
    ]);
    const cachePath = join(this.cacheDir, `${cacheKey}.rewrite.json`);
    const metadata: RewriteCacheMetadata = {
      transcriptHash,
      candidateSetHash: setHash,
      model: this.model,
      promptVersion: this.editorRewritePromptVersion,
    };

    let rewrites = await readRewriteCache(cachePath, metadata);
    if (!rewrites) {
      rewrites = await this.fetchRewriteCandidates({ resource, excerpts, selected });
      if (rewrites && rewrites.length > 0) {
        await writeRewriteCache(cachePath, metadata, rewrites);
      }
    }
    if (!rewrites || rewrites.length === 0) return selected;

    const rewriteByIndex = new Map<number, string>();
    for (const rewrite of rewrites) {
      if (!rewriteByIndex.has(rewrite.index)) {
        rewriteByIndex.set(rewrite.index, rewrite.text);
      }
    }

    const excerptTextById = new Map(excerpts.map(excerpt => [excerpt.id, excerpt.content ?? '']));
    return selected.map((candidate, index) => {
      const rewriteText = rewriteByIndex.get(index);
      if (!rewriteText) return candidate;
      const normalizedRewrite = normalizeText(rewriteText);
      if (normalizedRewrite.length === 0) return candidate;
      if (hasNumericTokenLoss(candidate.text, normalizedRewrite)) return candidate;
      const sourceTexts = [
        candidate.text,
        ...candidate.excerptIds.map(excerptId => excerptTextById.get(excerptId) ?? ''),
      ];
      if (keywordOverlapRatio(normalizedRewrite, sourceTexts) < this.editorRewriteMinKeywordOverlap) {
        return candidate;
      }
      if (editRatio(candidate.text, normalizedRewrite) > this.editorRewriteMaxEditRatio) {
        return candidate;
      }
      return {
        ...candidate,
        text: normalizedRewrite,
      };
    });
  }

  private async fetchRewriteCandidates(input: {
    resource: GraphNode;
    excerpts: GraphNode[];
    selected: ClaimCandidate[];
  }): Promise<Array<{ index: number; text: string }> | null> {
    const excerptTextById = new Map(input.excerpts.map(excerpt => [excerpt.id, excerpt.content ?? '']));
    const claimsPayload = input.selected.map((candidate, index) => ({
      index,
      text: candidate.text,
      excerptIds: candidate.excerptIds,
      excerptText: candidate.excerptIds
        .map(excerptId => excerptTextById.get(excerptId) ?? '')
        .join(' '),
      startSeconds: candidate.startSeconds ?? 0,
    }));
    const system = [
      'You are a high-resolution information extraction agent.',
      'You revise claim text for extreme clarity and technical precision while preserving provenance.',
      'Return only JSON matching the schema with claim indexes and revised text.',
      'Constraint: Every revised claim MUST be a specific, standalone assertion.',
      'Constraint: Preserve all technical terms, numbers, and units exactly.',
    ].join(' ');
    const user = [
      `Video: ${input.resource.label}`,
      `Schema: {"claims":[{"index":number,"text":string}]}`,
      'Goal: Rewrite each claim to be as useful and high-resolution as possible.',
      'Instruction: If a claim is generic, look at its excerptText and add specific details (numbers, mechanisms).',
      'Instruction: Maintain strict grounding in the provided evidence.',
      `CLAIMS:\n${JSON.stringify(claimsPayload, null, 2)}`,
    ].join('\n');

    const request = {
      model: this.model,
      system,
      user,
      temperature: 0,
      maxTokens: 2000,
      reasoningEffort: this.reasoningEffort,
      verbosity: this.verbosity,
    };
    const response = await this.client.generate(request);
    if (!response.ok) return null;
    const parsed = this.parseRewriteResponse(response.value);
    if (parsed) return parsed;

    const retry = await this.client.generate({
      ...request,
      user: `${user}\nReturn ONLY valid JSON. Do not include commentary or markdown.`,
    });
    if (!retry.ok) return null;
    return this.parseRewriteResponse(retry.value);
  }

  private parseRewriteResponse(content: string): Array<{ index: number; text: string }> | null {
    const jsonBlock = extractJsonBlock(content);
    if (!jsonBlock) return null;
    try {
      const parsed = RewriteResponseSchema.parse(JSON.parse(jsonBlock));
      return parsed.claims.map(claim => ({
        index: claim.index,
        text: normalizeText(claim.text),
      }));
    } catch {
      return null;
    }
  }

  private async extractChunkClaims(input: {
    resource: GraphNode;
    chunk: ClaimChunk;
    transcriptHash: string;
    excerptStartMap: Map<string, number>;
    chunkCount: number;
  }): Promise<ClaimCandidate[]> {
    const { resource, chunk, transcriptHash, excerptStartMap, chunkCount } = input;
    const videoId = typeof resource.metadata?.['videoId'] === 'string'
      ? (resource.metadata?.['videoId'] as string)
      : resource.id;
    const cacheKey = cacheKeyForChunk({
      videoId,
      chunk,
      transcriptHash,
      model: this.model,
      promptVersion: this.promptVersion,
    });
    const cachePath = join(this.cacheDir, `${cacheKey}.json`);
    const cacheMetadata = cacheMetadataForChunk({
      transcriptHash,
      model: this.model,
      promptVersion: this.promptVersion,
      chunk,
    });
    const cached = await readCache(cachePath, cacheMetadata);
    if (cached) {
      return cached.map(claim => ({
        ...claim,
        method: 'llm' as const,
        model: this.model,
        promptVersion: this.promptVersion,
        chunkIndex: chunk.index,
      }));
    }

    const excerptsPayload = chunk.excerpts.map(excerpt => ({
      id: excerpt.id,
      startSeconds: toNumber(excerpt.metadata?.['start'], 0),
      text: normalizeText(excerpt.content ?? ''),
    }));
    const system = [
      'You are a senior analyst extracting high-resolution health and physiological assertions.',
      'Return only JSON that matches the provided schema.',
      'CRITICAL: Over-index on specificity and niche technical insights.',
      'CRITICAL: Reject generic advice (e.g. "eat balanced meals", "sleep more").',
      'CRITICAL: Aim for diverse claims across different metabolic and physiological domains.',
    ].join(' ');
    const user = [
      `Video: ${resource.label}`,
      `Chunk ${chunk.index + 1}/${chunkCount} starting at ${Math.floor(chunk.start)}s.`,
      `Goal: Extract ${DEFAULT_MIN_CLAIMS_PER_CHUNK}-${DEFAULT_MAX_CLAIMS_PER_CHUNK} high-utility claims.`,
      `Schema: {"claims":[{"text":string,"excerptIds":[string],"startSeconds":number,"type":string,"classification":"Fact"|"Mechanism"|"Opinion","domain":string,"confidence":0-1,"why":string}]}`,
      `Allowed types: ${CLAIM_TYPES.join(', ')}`,
      'Requirement: If you find a generic claim, replace it with a more specific one from the same text.',
      'Requirement: Include the physiological Domain (e.g. "Protein Kinetics", "Lipidology") and Classification.',
      `EXCERPTS:\n${JSON.stringify(excerptsPayload, null, 2)}`,
    ].join('\n');

    const parsed = await this.fetchAndParseClaims({
      system,
      user,
      chunk,
      excerptStartMap,
      strictRetry: true,
      reasoningEffort: this.reasoningEffort,
      verbosity: this.verbosity,
    });

    if (parsed.length > 0) {
      await writeCache(cachePath, cacheMetadata, parsed);
      return parsed;
    }

    if (this.fallback) {
      console.warn(`LLM extraction failed or returned no results for chunk ${chunk.index}; falling back to heuristic.`);
      const fallbackClaims = await this.fallback.extractClaims({
        resource,
        excerpts: chunk.excerpts,
        maxClaims: DEFAULT_MAX_CLAIMS_PER_CHUNK,
      });
      return fallbackClaims.map(candidate => ({
        ...candidate,
        method: candidate.method ?? 'heuristic',
        chunkIndex: chunk.index,
      }));
    }

    return [];
  }

  private async fetchAndParseClaims(input: {
    system: string;
    user: string;
    chunk: ClaimChunk;
    excerptStartMap: Map<string, number>;
    strictRetry: boolean;
    reasoningEffort?: string;
    verbosity?: string;
  }): Promise<ClaimCandidate[]> {
    const { system, user, chunk, excerptStartMap, strictRetry, reasoningEffort, verbosity } = input;
    const request = {
      model: this.model,
      system,
      user,
      reasoningEffort,
      verbosity,
    };
    const response = await this.client.generate(request);
    if (!response.ok) {
      console.error(`LLM error in chunk ${chunk.index}: ${response.error.message}`);
      return [];
    }

    const parsed = this.parseResponse(response.value, chunk, excerptStartMap);
    if (parsed.length > 0 || !strictRetry) return parsed;

    const retry = await this.client.generate({
      ...request,
      user: `${user}\nReturn ONLY valid JSON. Do not include commentary or markdown.`,
    });
    if (!retry.ok) {
      console.error(`LLM retry error in chunk ${chunk.index}: ${retry.error.message}`);
      return [];
    }
    return this.parseResponse(retry.value, chunk, excerptStartMap);
  }

  private parseResponse(
    content: string,
    chunk: ClaimChunk,
    excerptStartMap: Map<string, number>
  ): ClaimCandidate[] {
    const jsonBlock = extractJsonBlock(content);
    if (!jsonBlock) return [];
    let parsed: z.infer<typeof ResponseSchema>;
    try {
      parsed = ResponseSchema.parse(JSON.parse(jsonBlock));
    } catch {
      return [];
    }

    const validIds = new Set(chunk.excerpts.map(excerpt => excerpt.id));
    const results: ClaimCandidate[] = [];
    for (const candidate of parsed.claims.slice(0, DEFAULT_MAX_CLAIMS_PER_CHUNK)) {
      const excerptIds = candidate.excerptIds.filter(id => validIds.has(id));
      if (excerptIds.length === 0) continue;
      const derivedStart = Math.min(...excerptIds.map(id => excerptStartMap.get(id) ?? 0));
      const startSeconds = typeof candidate.startSeconds === 'number'
        ? candidate.startSeconds
        : (Number.isFinite(derivedStart) ? derivedStart : 0);
      results.push({
        text: normalizeText(candidate.text),
        excerptIds,
        confidence: clamp(candidate.confidence ?? 0.7, 0, 1),
        startSeconds,
        type: normalizeType(candidate.type),
        classification: candidate.classification,
        domain: candidate.domain,
        why: candidate.why ? normalizeText(candidate.why) : undefined,
        method: 'llm',
        chunkIndex: chunk.index,
        model: this.model,
        promptVersion: this.promptVersion,
      });
    }
    return results;
  }
}
