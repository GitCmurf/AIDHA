import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import type { GraphNode } from '@aidha/graph-backend';
import type { Result } from '../pipeline/types.js';
import type { ClaimCandidate, ClaimExtractionInput, ClaimExtractor } from './types.js';
import { HeuristicClaimExtractor } from './claims.js';
import type { LlmClient } from './llm-client.js';
import { hashId } from '../utils/ids.js';

const CLAIM_TYPES = [
  'insight',
  'instruction',
  'fact',
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

interface ClaimChunk {
  index: number;
  start: number;
  end: number;
  excerpts: GraphNode[];
}

type CacheMetadata = z.infer<typeof CacheMetadataSchema>;

export interface LlmClaimExtractorConfig {
  client: LlmClient;
  model: string;
  promptVersion: string;
  chunkMinutes?: number;
  maxChunks?: number;
  maxClaims?: number;
  cacheDir?: string;
  fallback?: ClaimExtractor;
}

const DEFAULT_CHUNK_MINUTES = 5;
const DEFAULT_MAX_CLAIMS = 15;
const DEFAULT_CACHE_DIR = './out/cache/claims';
const DEFAULT_MIN_CLAIMS_PER_CHUNK = 3;
const DEFAULT_MAX_CLAIMS_PER_CHUNK = 8;

const LOW_VALUE_PATTERNS = [
  /subscribe/i,
  /like and subscribe/i,
  /smash that (like|subscribe)/i,
  /sponsor/i,
  /patreon/i,
  /thanks for watching/i,
  /welcome back/i,
  /intro/i,
  /outro/i,
];

function normalizeText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function normalizeKey(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();
}

function toNumber(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && !Number.isNaN(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value);
    return Number.isNaN(parsed) ? fallback : parsed;
  }
  return fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function isLowValue(text: string): boolean {
  return LOW_VALUE_PATTERNS.some(pattern => pattern.test(text));
}

function isTooShort(text: string): boolean {
  const trimmed = text.trim();
  const words = trimmed.split(/\s+/).filter(Boolean).length;
  return trimmed.length < 40 || words < 6;
}

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

function scoreCandidate(candidate: ClaimCandidate): number {
  const confidence = clamp(candidate.confidence ?? 0.6, 0, 1);
  const lengthScore = clamp((candidate.text.length ?? 0) / 180, 0, 1);
  return confidence * 0.7 + lengthScore * 0.3;
}

function stableExcerptKey(candidate: ClaimCandidate): string {
  return Array.from(new Set(candidate.excerptIds)).sort((a, b) => a.localeCompare(b)).join('|');
}

function compareCandidatePriority(a: ClaimCandidate, b: ClaimCandidate): number {
  const scoreDiff = scoreCandidate(b) - scoreCandidate(a);
  if (Math.abs(scoreDiff) > 0.000001) return scoreDiff;
  const startDiff = candidateStart(a) - candidateStart(b);
  if (startDiff !== 0) return startDiff;
  const textDiff = a.text.localeCompare(b.text);
  if (textDiff !== 0) return textDiff;
  return stableExcerptKey(a).localeCompare(stableExcerptKey(b));
}

function excerptOverlapRatio(a: ClaimCandidate, b: ClaimCandidate): number {
  const aSet = new Set(a.excerptIds);
  const bSet = new Set(b.excerptIds);
  if (aSet.size === 0 || bSet.size === 0) return 0;
  let intersection = 0;
  for (const id of aSet) {
    if (bSet.has(id)) intersection += 1;
  }
  const denominator = Math.min(aSet.size, bSet.size);
  if (denominator === 0) return 0;
  return intersection / denominator;
}

function shouldMergeCandidates(a: ClaimCandidate, b: ClaimCandidate): boolean {
  if (normalizeKey(a.text) === normalizeKey(b.text)) return true;
  return excerptOverlapRatio(a, b) >= 0.8;
}

function dedupeCandidates(candidates: ClaimCandidate[]): ClaimCandidate[] {
  const ranked = candidates.slice().sort(compareCandidatePriority);
  const deduped: ClaimCandidate[] = [];

  for (const candidate of ranked) {
    const existingIndex = deduped.findIndex(existing => shouldMergeCandidates(existing, candidate));
    if (existingIndex === -1) {
      deduped.push(candidate);
      continue;
    }

    const existing = deduped[existingIndex];
    if (existing && compareCandidatePriority(candidate, existing) < 0) {
      deduped[existingIndex] = candidate;
    }
  }

  return deduped.sort((a, b) => {
    const aStart = candidateStart(a);
    const bStart = candidateStart(b);
    if (aStart !== bStart) return aStart - bStart;
    const textDiff = a.text.localeCompare(b.text);
    if (textDiff !== 0) return textDiff;
    return stableExcerptKey(a).localeCompare(stableExcerptKey(b));
  });
}

function selectDiverseCandidates(
  candidates: ClaimCandidate[],
  maxClaims: number,
  chunkCount: number
): ClaimCandidate[] {
  const scored = candidates
    .map(candidate => ({ candidate, score: scoreCandidate(candidate) }))
    .sort((a, b) => {
      const scoreDiff = b.score - a.score;
      if (Math.abs(scoreDiff) > 0.000001) return scoreDiff;
      const aStart = candidateStart(a.candidate);
      const bStart = candidateStart(b.candidate);
      if (aStart !== bStart) return aStart - bStart;
      const textDiff = a.candidate.text.localeCompare(b.candidate.text);
      if (textDiff !== 0) return textDiff;
      return stableExcerptKey(a.candidate).localeCompare(stableExcerptKey(b.candidate));
    });

  const byChunk = new Map<number, { candidate: ClaimCandidate; score: number }[]>();
  for (const entry of scored) {
    const chunkIndex = entry.candidate.chunkIndex ?? -1;
    if (!byChunk.has(chunkIndex)) byChunk.set(chunkIndex, []);
    byChunk.get(chunkIndex)?.push(entry);
  }

  const selected: ClaimCandidate[] = [];
  for (let index = 0; index < chunkCount && selected.length < maxClaims; index++) {
    const bucket = byChunk.get(index);
    if (!bucket || bucket.length === 0) continue;
    const best = bucket.sort((a, b) => b.score - a.score)[0];
    if (best) selected.push(best.candidate);
  }

  for (const entry of scored) {
    if (selected.length >= maxClaims) break;
    if (selected.includes(entry.candidate)) continue;
    selected.push(entry.candidate);
  }

  return selected.slice(0, maxClaims).sort((a, b) => {
    const aStart = candidateStart(a);
    const bStart = candidateStart(b);
    if (aStart !== bStart) return aStart - bStart;
    const textDiff = a.text.localeCompare(b.text);
    if (textDiff !== 0) return textDiff;
    return stableExcerptKey(a).localeCompare(stableExcerptKey(b));
  });
}

function candidateStart(candidate: ClaimCandidate): number {
  return typeof candidate.startSeconds === 'number' ? candidate.startSeconds : Number.MAX_SAFE_INTEGER;
}

function runEditorPass(
  candidates: ClaimCandidate[],
  maxClaims: number,
  chunkCount: number
): ClaimCandidate[] {
  const filtered = candidates.filter(candidate => {
    const text = normalizeText(candidate.text);
    if (text.length === 0) return false;
    if (isLowValue(text)) return false;
    if (isTooShort(text)) return false;
    return true;
  });

  const deduped = dedupeCandidates(filtered);
  return selectDiverseCandidates(deduped, maxClaims, chunkCount);
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
      confidence: claim.confidence,
      why: claim.why,
    })),
  };
  await writeFile(path, JSON.stringify(payload, null, 2), 'utf-8');
}

export class LlmClaimExtractor implements ClaimExtractor {
  private client: LlmClient;
  private model: string;
  private promptVersion: string;
  private chunkMinutes: number;
  private maxChunks?: number;
  private maxClaims: number;
  private cacheDir: string;
  private fallback?: ClaimExtractor;

  constructor(config: LlmClaimExtractorConfig) {
    this.client = config.client;
    this.model = config.model;
    this.promptVersion = config.promptVersion;
    this.chunkMinutes = config.chunkMinutes ?? DEFAULT_CHUNK_MINUTES;
    this.maxChunks = config.maxChunks;
    this.maxClaims = config.maxClaims ?? DEFAULT_MAX_CLAIMS;
    this.cacheDir = config.cacheDir ?? DEFAULT_CACHE_DIR;
    this.fallback = config.fallback ?? new HeuristicClaimExtractor();
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

    return runEditorPass(allCandidates, maxClaims, chunked.length);
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
    const cacheKey = hashId('llm-claims', [
      videoId,
      chunk.index,
      chunk.start,
      chunk.end,
      transcriptHash,
      this.model,
      this.promptVersion,
    ]);
    const cachePath = join(this.cacheDir, `${cacheKey}.json`);
    const cacheMetadata: CacheMetadata = {
      transcriptHash,
      model: this.model,
      promptVersion: this.promptVersion,
      chunkIndex: chunk.index,
      chunkStart: chunk.start,
      chunkEnd: chunk.end,
    };
    const cached = await readCache(cachePath, cacheMetadata);
    if (cached) {
      return cached.map(claim => ({
        ...claim,
        method: 'llm',
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
      'You extract auditable claims from transcript excerpts.',
      'Return only JSON that matches the provided schema.',
      'Avoid sponsor/intro/outro chatter and keep claims specific.',
    ].join(' ');
    const user = [
      `Video: ${resource.label}`,
      `Chunk ${chunk.index + 1}/${chunkCount} starting at ${Math.floor(chunk.start)}s.`,
      `Return ${DEFAULT_MIN_CLAIMS_PER_CHUNK}-${DEFAULT_MAX_CLAIMS_PER_CHUNK} claims if possible.`,
      `Schema: {"claims":[{"text":string,"excerptIds":[string],"startSeconds":number,"type":string,"confidence":0-1,"why":string}]}`,
      `Allowed types: ${CLAIM_TYPES.join(', ')}`,
      'Use only excerptIds from the list below.',
      `EXCERPTS:\n${JSON.stringify(excerptsPayload, null, 2)}`,
    ].join('\n');

    const parsed = await this.fetchAndParseClaims({
      system,
      user,
      chunk,
      excerptStartMap,
      strictRetry: true,
    });

    if (parsed.length > 0) {
      await writeCache(cachePath, cacheMetadata, parsed);
      return parsed;
    }

    if (this.fallback) {
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
  }): Promise<ClaimCandidate[]> {
    const { system, user, chunk, excerptStartMap, strictRetry } = input;
    const request = {
      model: this.model,
      system,
      user,
    };
    const response = await this.client.generate(request);
    if (!response.ok) return [];

    const parsed = this.parseResponse(response.value, chunk, excerptStartMap);
    if (parsed.length > 0 || !strictRetry) return parsed;

    const retry = await this.client.generate({
      ...request,
      user: `${user}\nReturn ONLY valid JSON. Do not include commentary or markdown.`,
    });
    if (!retry.ok) return [];
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
