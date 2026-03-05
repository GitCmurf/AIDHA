import type { GraphNode, GraphStore, NodeDataInput } from '@aidha/graph-backend';
import type { Result } from '../pipeline/types.js';
import type { ClaimExtractionResult, ClaimExtractor, ClaimExtractionInput, ClaimCandidate } from './types.js';
import { hashId } from '../utils/ids.js';
import { DEFAULT_CLAIM_STATE, type ClaimState } from '../utils/claim-state.js';
import {
  normalizeText,
  normalizeKey,
  uniqueSortedStrings,
  splitSentences,
  hasDanglingEnding,
  isCompleteSentence,
  countFragmentIndicators,
  startsWithConnector,
  buildExcerptTextsById,
} from './utils.js';
import {
  extractSVOTriples,
  extractDiscourseMarkers,
  isGrammaticallyComplete,
  extractKeywords,
  hasBoilerplatePOSPattern,
} from './nlp-utils.js';
import { runEditorPassV2, runEditorPassV2WithDiagnostics, type EditorialDiagnostics, DEFAULT_ECHO_DETECTION } from './editorial-ranking.js';
import { z } from 'zod';

/**
 * Runtime schema for claim validation.
 * Matches ClaimCandidate interface for runtime validation.
 */
const ClaimCandidateSchema = z.object({
  text: z.string().min(1),
  excerptIds: z.array(z.string()).min(1),
  confidence: z.number().min(0).max(1).optional(),
  startSeconds: z.number().nonnegative().optional(),
  type: z.string().optional(),
  classification: z.string().optional(),
  domain: z.string().optional(),
  why: z.string().optional(),
  evidenceType: z.string().optional(),
  method: z.enum(['heuristic', 'heuristic-fallback', 'llm']).optional(),
  chunkIndex: z.number().int().optional(),
  model: z.string().optional(),
  promptVersion: z.string().optional(),
  extractorVersion: z.string().optional(),
  echoOverlapRatio: z.number().min(0).max(1).optional(),
  state: z.enum(['draft', 'accepted', 'rejected']).optional(),
});

/**
 * Validates a claim candidate against the runtime schema.
 * Returns the validated claim or null if validation fails.
 */
function validateClaim(claim: ClaimCandidate): ClaimCandidate | null {
  const result = ClaimCandidateSchema.safeParse(claim);
  if (!result.success) {
    // Log validation error for debugging (in production, would use proper logger)
    // Safely access text property, handling non-string values
    const textPreview = typeof claim.text === 'string'
      ? claim.text.slice(0, 50)
      : '[non-string text]';
    console.warn(`Claim validation failed for: "${textPreview}..."`, {
      error: result.error.errors.map(e => e.message).join(', '),
    });
    return null;
  }
  // Merge the validated result with original claim to preserve fields not in schema
  return { ...claim, ...result.data };
}

export interface ClaimExtractionConfig {
  graphStore: GraphStore;
  extractor?: ClaimExtractor;
}

interface TransactionalStore {
  runInTransaction<T>(work: () => Promise<Result<T>>): Promise<Result<T>>;
}

function hasTransactions(store: GraphStore): store is GraphStore & TransactionalStore {
  return typeof (store as Partial<TransactionalStore>).runInTransaction === 'function';
}

async function runAtomically<T>(
  store: GraphStore,
  work: () => Promise<Result<T>>
): Promise<Result<T>> {
  if (!hasTransactions(store)) {
    return work();
  }
  return store.runInTransaction(work);
}

/**
 * Default maximum gap in seconds for merging adjacent excerpts.
 * Excerpts within this window are merged if the first ends with a dangling marker.
 */
const DEFAULT_MERGE_GAP_SECONDS = 15;

/**
 * Minimum length for a sentence to be considered as a claim candidate.
 * Set lower than editorial pass to allow it to filter based on score.
 */
const MIN_SENTENCE_CHARS = 20;
const MIN_SENTENCE_WORDS = 4;

/**
 * Interface to track which excerpts contributed to each merged segment.
 */
interface MergedSegment {
  text: string;
  startSeconds: number | undefined;
  /** Start time of the last excerpt in this merged segment (used for gap calculation) */
  lastStartSeconds: number | undefined;
  excerptIndices: number[];
}

/**
 * Interface for mergeable segments.
 */
export interface MergeableSegment {
  text: string;
  startSeconds?: number;
  endSeconds?: number;
}

/**
 * Heuristic extractor that uses sentence-level analysis to extract claims.
 * This is a zero-dependency fallback that works without LLM access.
 */
export class HeuristicClaimExtractor implements ClaimExtractor {
  private lastEditorDiagnostics: EditorialDiagnostics | undefined;

  /**
   * Returns the editorial version used by this extractor.
   * The heuristic path uses v2 editorial filtering for better quality.
   */
  getEditorVersion(): 'v2' {
    return 'v2';
  }

  /**
   * Returns the diagnostics from the last editorial pass run.
   * Provides insight into drop reasons and window coverage for quality tuning.
   */
  getLastEditorDiagnostics(): EditorialDiagnostics | undefined {
    return this.lastEditorDiagnostics;
  }

  async extractClaims(input: ClaimExtractionInput): Promise<ClaimCandidate[]> {
    const maxClaims = input.maxClaims ?? 20;

    // Step 1: Convert excerpts to mergeable segments, keeping track of original indices
    const segments: Array<MergeableSegment & { originalIndex: number }> = input.excerpts
      .map((excerpt, index) => ({
        text: excerpt.content?.trim() ?? '',
        startSeconds: typeof excerpt.metadata?.['start'] === 'number'
          ? (excerpt.metadata?.['start'] as number)
          : undefined,
        originalIndex: index,
      }))
      .filter(segment => segment.text.length > 0)
      .sort((a, b) => {
        // Sort by startSeconds, with undefined values treated as Infinity
        const aStart = typeof a.startSeconds === 'number' ? a.startSeconds : Number.MAX_SAFE_INTEGER;
        const bStart = typeof b.startSeconds === 'number' ? b.startSeconds : Number.MAX_SAFE_INTEGER;
        if (aStart !== bStart) return aStart - bStart;
        return a.originalIndex - b.originalIndex;
      });

    if (segments.length === 0) {
      this.lastEditorDiagnostics = undefined;
      return [];
    }

    // For very short transcripts (test fixtures), use original behavior for compatibility
    if (segments.length <= 2) {
      this.lastEditorDiagnostics = undefined;

      const candidates: ClaimCandidate[] = segments.map(segment => ({
        text: segment.text,
        excerptIds: [input.excerpts[segment.originalIndex]?.id].filter((id): id is string => typeof id === 'string'),
        confidence: this.computeHeuristicConfidence(segment.text),
        startSeconds: segment.startSeconds,
        method: 'heuristic',
        extractorVersion: 'heuristic-v1',
      }));

      // Simple deduplication
      const seen = new Set<string>();
      const unique = candidates.filter(candidate => {
        const key = normalizeKey(candidate.text);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

      // Sort by timestamp for predictable ordering
      return unique
        .sort((a, b) => (a.startSeconds ?? 0) - (b.startSeconds ?? 0))
        .slice(0, maxClaims);
    }

    // Step 2: Merge adjacent excerpts within the gap window, tracking which excerpts contributed
    // segments.length > 2 here, so segments[0] and segments[i] are always defined
    const mergedSegments: MergedSegment[] = [];
    let currentMerged: MergedSegment = {
      text: segments[0]!.text,
      startSeconds: segments[0]!.startSeconds,
      lastStartSeconds: segments[0]!.startSeconds, // Initialize with first segment's start
      excerptIndices: [segments[0]!.originalIndex],
    };

    for (let i = 1; i < segments.length; i++) {
      const segment = segments[i]!;
      // Calculate gap from the last merged segment's start to the next segment's start
      // Since we don't have excerpt end times, we use the start of each excerpt as a proxy
      const gap = typeof currentMerged.lastStartSeconds === 'number' && typeof segment.startSeconds === 'number'
        ? segment.startSeconds - currentMerged.lastStartSeconds
        : Infinity;

      const shouldMerge = gap >= 0 && gap <= DEFAULT_MERGE_GAP_SECONDS &&
        (hasDanglingEnding(currentMerged.text) || startsWithConnector(segment.text));

      if (shouldMerge) {
        currentMerged.text += ' ' + segment.text;
        currentMerged.excerptIndices.push(segment.originalIndex);
        // Update lastStartSeconds to track the most recent segment's start time
        currentMerged.lastStartSeconds = segment.startSeconds;
      } else {
        mergedSegments.push(currentMerged);
        currentMerged = {
          text: segment.text,
          startSeconds: segment.startSeconds,
          lastStartSeconds: segment.startSeconds,
          excerptIndices: [segment.originalIndex],
        };
      }
    }
    mergedSegments.push(currentMerged);

    // Step 3: Split each merged segment into sentences and create candidates
    const sentenceCandidates: ClaimCandidate[] = [];
    for (const merged of mergedSegments) {
      const sentences = splitSentences(merged.text);

      for (const sentence of sentences) {
        const normalized = normalizeText(sentence);
        if (!normalized) continue;

        // Check minimum length requirements to match editorial pass v2
        const words = normalized.split(/\s+/).filter(Boolean).length;
        if (normalized.length < MIN_SENTENCE_CHARS && words < MIN_SENTENCE_WORDS) {
          continue; // Skip sentences that don't meet editorial pass minimums
        }

        // Find the excerpt IDs that contributed to this merged segment
        const excerptIds = merged.excerptIndices.map(idx => input.excerpts[idx]?.id).filter((id): id is string => typeof id === 'string');

        sentenceCandidates.push({
          text: normalized,
          excerptIds,
          confidence: this.computeHeuristicConfidence(normalized),
          startSeconds: merged.startSeconds,
          method: 'heuristic',
          extractorVersion: process.env['AIDHA_HEURISTIC_NLP_LIBRARY'] === 'true' ? 'heuristic-v1.1-nlp' : 'heuristic-v1.1',
        });
      }
    }

    if (sentenceCandidates.length === 0) {
      this.lastEditorDiagnostics = undefined;
      return [];
    }

    // Step 4: Deduplicate by normalized key (handles punctuation variants)
    const seen = new Set<string>();
    const unique = sentenceCandidates.filter(candidate => {
      const key = normalizeKey(candidate.text);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    if (unique.length === 0) {
      this.lastEditorDiagnostics = undefined;
      return [];
    }

    // Step 5: Apply editorial pass v2 for deterministic quality filtering
    // Adapt minWindows to the actual content length to avoid empty results
    const actualWindowCount = new Set(
      unique
        .map(c => typeof c.startSeconds === 'number' ? Math.floor(c.startSeconds / 300) : c.chunkIndex ?? -1)
        .filter(w => w >= 0)
    ).size;

    // For longer content, use full editorial pass v2
    const adaptiveMinWindows = Math.min(4, Math.max(1, actualWindowCount));

    // Build excerpt texts map for echo detection
    const excerptTextsById = buildExcerptTextsById(input.excerpts);

    const editorialResult = runEditorPassV2WithDiagnostics(unique, {
      maxClaims,
      chunkCount: mergedSegments.length,
      windowMinutes: 5,
      maxPerWindow: 3,
      minWindows: adaptiveMinWindows,
      excerptTextsById,
      echoDetection: DEFAULT_ECHO_DETECTION,
    });

    // Store diagnostics for retrieval
    this.lastEditorDiagnostics = editorialResult.diagnostics;
    const editorialFiltered = editorialResult.selected;

    // Step 6: Sort by quality (higher confidence first) and limit
    const sorted = editorialFiltered.sort((a, b) => {
      const confidenceDiff = (b.confidence ?? 0) - (a.confidence ?? 0);
      if (Math.abs(confidenceDiff) > 0.001) return confidenceDiff;
      return (a.startSeconds ?? Number.MAX_SAFE_INTEGER) - (b.startSeconds ?? Number.MAX_SAFE_INTEGER);
    });

    return sorted.slice(0, maxClaims);
  }

  /**
   * Computes a heuristic confidence score based on text features.
   * Higher scores for:
   * - Numbers and units (indicates specific claims)
   * - Complete sentences (not fragments)
   * - Longer text (more substantive)
   * - Fewer fragment indicators
   * - Grammatically complete sentences (NLP-enhanced)
   * - Clear SVO structure (NLP-enhanced)
   * - Discourse markers indicating complex reasoning (NLP-enhanced)
   * - Keyword richness (NLP-enhanced)
   * Penalties for:
   * - Boilerplate POS patterns (NLP-enhanced)
   */
  private computeHeuristicConfidence(text: string): number {
    let score = 0.4; // Base confidence

    // Bonus for numbers and units
    const hasNumber = /\d+/.test(text);
    const hasUnit = /%|mg|g|kg|ml|l|hour|hours|min|minute|minutes|sec|seconds|degree|degrees/i.test(text);
    if (hasNumber) score += 0.15;
    if (hasUnit) score += 0.1;

    // Bonus for complete sentences
    if (isCompleteSentence(text)) score += 0.1;

    // Bonus for longer text (up to a point)
    const lengthScore = Math.min(text.length / 200, 0.15);
    score += lengthScore;

    // Penalty for fragment indicators
    const fragmentCount = countFragmentIndicators(text);
    score -= fragmentCount * 0.1;

    // NLP-enhanced scoring factors
    // Bonus for grammatical completeness
    if (isGrammaticallyComplete(text)) score += 0.1;

    // Bonus for SVO structure
    const svoTriples = extractSVOTriples(text);
    if (svoTriples.length > 0) score += 0.1;

    // Bonus for discourse markers (causal/contrastive indicate complex reasoning)
    const discourseMarkers = extractDiscourseMarkers(text);
    const hasComplexReasoning = discourseMarkers.some(
      m => m.type === 'causal' || m.type === 'contrast'
    );
    if (hasComplexReasoning) score += 0.05;

    // Bonus for keyword richness (0.02-0.1 based on keyword count)
    const keywords = extractKeywords(text, { maxKeywords: 10 });
    const keywordScore = Math.min(keywords.length * 0.02, 0.1);
    score += keywordScore;

    // Penalty for boilerplate POS patterns
    if (hasBoilerplatePOSPattern(text)) score -= 0.15;

    return Math.min(0.95, Math.max(0.1, score));
  }
}

export class ClaimExtractionPipeline {
  private graphStore: GraphStore;
  private extractor: ClaimExtractor;

  constructor(config: ClaimExtractionConfig) {
    this.graphStore = config.graphStore;
    this.extractor = config.extractor ?? new HeuristicClaimExtractor();
  }

  async extractClaimsForVideo(
    videoId: string,
    options: { maxClaims?: number } = {}
  ): Promise<Result<ClaimExtractionResult>> {
    const resourceId = `youtube-${videoId}`;
    const resourceResult = await this.graphStore.getNode(resourceId);
    if (!resourceResult.ok) return resourceResult;
    if (!resourceResult.value) {
      return { ok: false, error: new Error(`Resource not found: ${resourceId}`) };
    }

    const excerptsResult = await this.graphStore.queryNodes({
      type: 'Excerpt',
      filters: { resourceId },
    });
    if (!excerptsResult.ok) return excerptsResult;
    const excerpts = excerptsResult.value.items;
    if (excerpts.length === 0) {
      const status = resourceResult.value.metadata?.['transcriptStatus'];
      const error = resourceResult.value.metadata?.['transcriptError'];
      const details = [status ? `status=${status}` : null, error ? `error=${error}` : null]
        .filter(Boolean)
        .join(', ');
      const message = details.length > 0
        ? `No excerpts found for ${resourceId} (${details})`
        : `No excerpts found for ${resourceId}`;
      return { ok: false, error: new Error(message) };
    }

    const candidates = await this.extractor.extractClaims({
      resource: resourceResult.value,
      excerpts,
      maxClaims: options.maxClaims,
    });
    const extractorEditorVersion = this.getExtractorEditorVersion();
    const firstModel = candidates.find(candidate => typeof candidate.model === 'string')?.model;
    const firstPromptVersion = candidates.find(
      candidate => typeof candidate.promptVersion === 'string'
    )?.promptVersion;

    // Validate claims against runtime schema before persistence
    const validatedCandidates = candidates.map(validateClaim).filter((c): c is ClaimCandidate => c !== null);
    const validationErrorCount = candidates.length - validatedCandidates.length;

    if (validationErrorCount > 0) {
      console.warn(`Dropped ${validationErrorCount} invalid claims for ${resourceId}`);
    }

    // Use validated candidates for persistence
    const persistenceCandidates = validatedCandidates;

    // Retrieve editorial diagnostics if available
    let editorialDiagnostics: EditorialDiagnostics | undefined;
    const maybeHeuristic = this.extractor as Partial<{ getLastEditorDiagnostics: () => EditorialDiagnostics | undefined }>;
    if (typeof maybeHeuristic.getLastEditorDiagnostics === 'function') {
      editorialDiagnostics = maybeHeuristic.getLastEditorDiagnostics();
    }

    let claimsCreated = 0;
    let claimsUpdated = 0;
    let claimsNoop = 0;
    let edgesCreated = 0;
    let edgesUpdated = 0;
    let edgesNoop = 0;
    const lastClaimRunAt = new Date().toISOString();
    const writeResult = await runAtomically(this.graphStore, async () => {
      for (const claim of persistenceCandidates) {
        // Use normalized key for claim ID to ensure punctuation variants map to same node
        // Sort excerptIds to ensure consistent hashing regardless of order
        const normalizedClaimKey = normalizeKey(claim.text);
        const sortedExcerptIds = uniqueSortedStrings(claim.excerptIds);
        const claimId = hashId('claim', [resourceId, normalizedClaimKey, ...sortedExcerptIds]);
        const label = claim.text.length > 120 ? `${claim.text.slice(0, 117)}...` : claim.text;
        const metadata: Record<string, unknown> = {
          resourceId,
          videoId,
          method: claim.method ?? 'heuristic',
          confidence: claim.confidence ?? 0.4,
          state: claim.state ?? DEFAULT_CLAIM_STATE,
        };
        if (extractorEditorVersion) metadata['editorVersion'] = extractorEditorVersion;
        if (typeof claim.startSeconds === 'number') metadata['startSeconds'] = claim.startSeconds;
        if (claim.type) metadata['type'] = claim.type;
        if (claim.classification) metadata['classification'] = claim.classification;
        if (claim.domain) metadata['domain'] = claim.domain;
        if (claim.evidenceType) metadata['evidenceType'] = claim.evidenceType;
        if (claim.why) metadata['why'] = claim.why;
        if (claim.model) metadata['model'] = claim.model;
        if (claim.promptVersion) metadata['promptVersion'] = claim.promptVersion;
        if (typeof claim.echoOverlapRatio === 'number') metadata['echoOverlapRatio'] = claim.echoOverlapRatio;

        const data: NodeDataInput = {
          label,
          content: claim.text,
          metadata,
        };

        const upsert = await this.graphStore.upsertNode('Claim', claimId, data, { detectNoop: true });
        if (!upsert.ok) return upsert;
        if (upsert.value.created) claimsCreated++;
        else if (upsert.value.updated) claimsUpdated++;
        else if (upsert.value.noop) claimsNoop++;

        for (const excerptId of claim.excerptIds) {
          const edge = await this.graphStore.upsertEdge(
            claimId,
            'claimDerivedFrom',
            excerptId,
            { metadata: { confidence: claim.confidence ?? 0.4 } },
            { detectNoop: true }
          );
          if (!edge.ok) return edge;
          if (edge.value.created) edgesCreated++;
          else if (edge.value.updated) edgesUpdated++;
          else if (edge.value.noop) edgesNoop++;
        }
      }

      const latestResourceResult = await this.graphStore.getNode(resourceId);
      if (!latestResourceResult.ok) return latestResourceResult;
      if (!latestResourceResult.value) {
        return { ok: false, error: new Error(`Resource not found: ${resourceId}`) };
      }

      const existingMetadata = (latestResourceResult.value.metadata ?? {}) as Record<string, unknown>;
      const runMetadata: Record<string, unknown> = {
        ...existingMetadata,
        lastClaimRunAt,
        lastClaimRunCandidates: candidates.length,
        lastClaimRunValidated: persistenceCandidates.length,
        lastClaimRunValidationErrors: validationErrorCount,
        lastClaimRunCreated: claimsCreated,
        lastClaimRunUpdated: claimsUpdated,
        lastClaimRunNoop: claimsNoop,
        lastClaimRunEdgesCreated: edgesCreated,
        lastClaimRunEdgesUpdated: edgesUpdated,
        lastClaimRunEdgesNoop: edgesNoop,
        lastClaimRunExtractor: this.extractor.constructor.name,
      };
      if (extractorEditorVersion) {
        runMetadata['lastClaimRunEditorVersion'] = extractorEditorVersion;
      }
      if (firstModel) {
        runMetadata['lastClaimRunModel'] = firstModel;
      }
      if (firstPromptVersion) {
        runMetadata['lastClaimRunPromptVersion'] = firstPromptVersion;
      }
      if (editorialDiagnostics) {
        runMetadata['lastClaimRunEditorDiagnostics'] = JSON.stringify(editorialDiagnostics);
      }

      const resourceUpdate = await this.graphStore.upsertNode(
        'Resource',
        resourceId,
        {
          label: latestResourceResult.value.label,
          content: latestResourceResult.value.content,
          metadata: runMetadata,
        },
        { detectNoop: true }
      );
      if (!resourceUpdate.ok) return resourceUpdate;
      return { ok: true, value: undefined };
    });
    if (!writeResult.ok) return writeResult;

    return {
      ok: true,
      value: {
        resourceId,
        claimsCreated,
        claimsUpdated,
        claimsNoop,
        edgesCreated,
        edgesUpdated,
        edgesNoop,
      },
    };
  }

  private getExtractorEditorVersion(): 'v1' | 'v2' | undefined {
    const maybeVersioned = this.extractor as Partial<{ getEditorVersion: () => 'v1' | 'v2' }>;
    if (typeof maybeVersioned.getEditorVersion !== 'function') return undefined;
    return maybeVersioned.getEditorVersion();
  }
}

export type { ClaimExtractionInput, ClaimCandidate };
