export type {
  ClaimCandidate,
  ClaimExtractionInput,
  ClaimExtractionResult,
  ReferenceExtractionResult,
} from './types.js';
export type { PurgeClaimsResult } from './purge.js';
export { ClaimExtractionPipeline, HeuristicClaimExtractor } from './claims.js';
export { purgeClaimsForVideo } from './purge.js';
export { LlmClaimExtractor, loadCachedClaimCandidates } from './llm-claims.js';
export type { CachedClaimsLoadOptions, CachedClaimsLoadResult } from './llm-claims.js';
export type {
  EditorialDiagnostics,
  EditorialDropReason,
  EditorialPassV1Options,
  EditorialPassV2Options,
} from './editorial-ranking.js';
export {
  runEditorPassV1,
  runEditorPassV1WithDiagnostics,
  runEditorPassV2,
  runEditorPassV2WithDiagnostics,
} from './editorial-ranking.js';
export { countFragments, countBoilerplate, timelineCoverage, dropCounts } from './editorial-metrics.js';
export type { FragmentRules, CoverageSummary } from './editorial-metrics.js';
export type { LlmClient, LlmCompletionRequest } from './llm-client.js';
export { OpenAiCompatibleClient } from './llm-client.js';
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
