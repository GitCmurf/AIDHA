export type {
  ClaimCandidate,
  ClaimExtractionInput,
  ClaimExtractionResult,
  ClaimExtractor,
  ReferenceExtractionResult,
} from './types.js';
export type { PurgeClaimsResult } from './purge.js';
export { ClaimExtractionPipeline, HeuristicClaimExtractor } from './claims.js';
export { purgeClaimsForResource, purgeClaimsForVideo } from './purge.js';
export {
  LlmClaimExtractor,
  loadCachedClaimCandidates,
  getEffectivePromptVersion,
} from './llm-claims.js';
export type {
  CachedClaimsLoadOptions,
  CachedClaimsLoadResult,
  ExtractionRunStats,
} from './llm-claims.js';
export type {
  EchoDetectionMode,
  EditorialDiagnostics,
  EditorialDropReason,
  EditorialPassV1Options,
  EditorialPassV2Options,
} from './editorial-ranking.js';
export {
  DEFAULT_ECHO_DETECTION,
  expandContractions,
  hasNumericalDifference,
  hasSubjectOrPredicateChange,
  runEditorPassV1,
  runEditorPassV1WithDiagnostics,
  runEditorPassV2,
  runEditorPassV2WithDiagnostics,
} from './editorial-ranking.js';
export { countFragments, countBoilerplate, timelineCoverage, dropCounts } from './editorial-metrics.js';
export type { FragmentRules, CoverageSummary } from './editorial-metrics.js';
export type {
  GeminiApiConfig,
  LlmClient,
  LlmCompletionRequest,
  LlmCompletionResult,
  LlmResolvedConfig,
  LlmTokenUsage,
  ModelCapabilities,
  OpenAiCompatibleConfig,
} from './llm-client.js';
export {
  createGeminiClientFromConfig,
  createLlmClientFromConfig,
  detectModelCapabilities,
  GeminiApiClient,
  normalizeBaseUrl,
  OpenAiCompatibleClient,
} from './llm-client.js';
export { estimateCost, estimateTokens, DEFAULT_COST_PER_1K_TOKENS } from './token-budget.js';
export {
  calculateChunkBudget,
  chunkTextByTokenBudget,
  createTokenBudgetSummary,
  exceedsTokenBudget,
  formatTokenCount,
} from './token-budget.js';
export type { ChunkTokenBudget, TokenBudgetSummary } from './token-budget.js';
export { ReferenceExtractionPipeline } from './references.js';
export type {
  VerificationResult,
  VerificationConfig,
  VerificationTier,
} from './verification.js';
export {
  TieredVerifier,
  calculateTokenOverlap,
  calculateNGramOverlap,
  extractKeyPhrases,
} from './verification.js';
export {
  GENERIC_TERMS,
  GENERIC_TERMS_MAX,
  STOPWORDS,
} from './keyphrases.js';
export { buildSourceSynopsis } from './source-synopsis.js';
export type { BuildSourceSynopsisInput } from './source-synopsis.js';
export {
  applyClaimQualityAssessment,
  assessClaimQuality,
  CLAIM_QUALITY_REASONS,
  CLAIM_QUALITY_STATUSES,
} from './claim-quality.js';
export type {
  ClaimQualityAssessment,
  ClaimQualityInput,
  ClaimQualityReason,
  ClaimQualityStatus,
} from './claim-quality.js';
export {
  buildPass1PromptV2,
  buildSystemPrompt,
  buildUserPrompt,
  PASS1_PROMPT_CONFIG_IDS,
  PROMPT_VERSION,
  promptVersionForConfig,
} from './prompts/pass1-claim-mining-v2.js';
export type { Pass1PromptConfigId } from './prompts/pass1-claim-mining-v2.js';
export { buildSelfImproveClaimsPrompt } from './prompts/self-improve-claims-v1.js';
export {
  buildTranscriptProfile,
  decidePromptPack,
  determineRetryDecision,
  scoreStructuralCompleteness,
} from './prompt-routing.js';
export type {
  ExtractionPromptPackId,
  PromptRetryDecision,
  PromptRetryReason,
  PromptRouteSource,
  PromptRoutingDecision,
  TranscriptProfile,
} from './prompt-routing.js';
export {
  buildExcerptTextsById,
  buildTimestampUrl,
  clamp,
  deduplicateByKey,
  escapeRegExp,
  extractUrls,
  formatErrorRecord,
  formatTimestamp,
  countFragmentIndicators,
  hasDanglingEnding,
  isCompleteSentence,
  mergeAdjacentSegments,
  normalizeKey,
  rangesOverlap,
  splitSentences,
  startsWithConnector,
} from './utils.js';
export type { MergeableSegment } from './utils.js';

// Circuit breaker exports
export type { CircuitBreakerConfig } from './circuit-breaker.js';
export {
  CircuitBreaker,
  CircuitBreakerState,
  CircuitBreakerOpenError,
} from './circuit-breaker.js';

// Claim candidate schema exports
export {
  ClaimCandidateSchema,
  CLAIM_TYPES,
  CLAIM_CLASSIFICATIONS,
  CLAIM_STATES,
  CLAIM_METHODS,
  validateClaimCandidate,
  isValidClaimCandidate,
  normalizeClaimType,
  normalizeClaimClassification,
} from './claim-candidate-schema.js';

// Distillation pipeline exports
export * from './distill/index.js';

// NLP utilities exports
export {
  extractSVOTriples,
  extractDiscourseMarkers,
  hasPOSPattern,
  getPOSPattern,
  isGrammaticallyComplete,
  extractKeywords,
  hasBoilerplatePOSPattern,
} from './nlp-utils.js';
