import { z } from 'zod';
import type { ClaimCandidate } from './types.js';

/**
 * Valid claim type values.
 * These describe the nature of the claim content.
 */
export const CLAIM_TYPES = [
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
] as const;

/**
 * Valid claim classification values.
 * These categorize claims into broad semantic categories.
 *
 * Must match CLASSIFICATIONS in pass1-claim-mining-v2.ts to ensure
 * normalizeClaimClassification doesn't silently drop valid values.
 */
export const CLAIM_CLASSIFICATIONS = ['fact', 'mechanism', 'opinion', 'warning', 'instruction', 'insight'] as const;

/**
 * Valid claim state values.
 * These track the review status of a claim.
 */
export const CLAIM_STATES = ['draft', 'accepted', 'rejected'] as const;

/**
 * Valid claim extraction method values.
 * These indicate how the claim was identified.
 */
export const CLAIM_METHODS = ['heuristic', 'heuristic-fallback', 'llm'] as const;

/**
 * Zod schema for validating ClaimCandidate objects.
 * Provides runtime type checking and normalization for claim data.
 *
 * @example
 * ```ts
 * const result = ClaimCandidateSchema.safeParse(unknownData);
 * if (result.success) {
 *   const claim: ClaimCandidate = result.data;
 * }
 * ```
 */
export const ClaimCandidateSchema = z.object({
  text: z.string().trim().min(1, 'Claim text cannot be empty'),
  excerptIds: z.array(z.string().trim().min(1, 'Excerpt ID cannot be empty')).min(1, 'At least one excerpt ID is required'),
  confidence: z.number().min(0).max(1).optional(),
  startSeconds: z.number().nonnegative().optional(),
  type: z.enum(CLAIM_TYPES).optional(),
  classification: z.enum(CLAIM_CLASSIFICATIONS).optional(),
  domain: z.string().optional(),
  why: z.string().optional(),
  evidenceType: z.string().optional(),
  method: z.enum(CLAIM_METHODS).optional(),
  chunkIndex: z.number().int().nonnegative().optional(),
  model: z.string().optional(),
  promptVersion: z.string().optional(),
  extractorVersion: z.string().optional(),
  state: z.enum(CLAIM_STATES).optional(),
  echoOverlapRatio: z.number().min(0).max(1).optional(),
});

/**
 * Validates an unknown value as a ClaimCandidate.
 * Returns a discriminated union with success status and either the parsed data or an error message.
 *
 * @param claim - The value to validate
 * @returns An object indicating success or failure with data or error message
 *
 * @example
 * ```ts
 * const result = validateClaimCandidate(rawClaim);
 * if (result.success) {
 *   await saveClaim(result.data);
 * } else {
 *   console.error('Validation failed:', result.error);
 * }
 * ```
 */
export function validateClaimCandidate(
  claim: unknown
): { success: true; data: ClaimCandidate } | { success: false; error: string } {
  const result = ClaimCandidateSchema.safeParse(claim);
  if (result.success) {
    return { success: true, data: result.data };
  }
  return { success: false, error: result.error.message };
}

/**
 * Type guard that checks if a value is a valid ClaimCandidate.
 *
 * @param claim - The value to check
 * @returns True if the value is a valid ClaimCandidate, false otherwise
 *
 * @example
 * ```ts
 * if (isValidClaimCandidate(unknownValue)) {
 *   // unknownValue is now typed as ClaimCandidate
 *   processClaim(unknownValue);
 * }
 * ```
 */
export function isValidClaimCandidate(claim: unknown): claim is ClaimCandidate {
  return ClaimCandidateSchema.safeParse(claim).success;
}

/**
 * Normalizes a string value to a valid claim type.
 * Returns undefined if the value is not a recognized claim type.
 *
 * @param type - The string value to normalize
 * @returns The normalized claim type or undefined
 *
 * @example
 * ```ts
 * const normalized = normalizeClaimType('INSIGHT'); // returns 'insight'
 * const invalid = normalizeClaimType('unknown');    // returns undefined
 * ```
 */
export function normalizeClaimType(
  type: string | undefined
): (typeof CLAIM_TYPES)[number] | undefined {
  if (!type) return undefined;
  const normalized = type.toLowerCase();
  return CLAIM_TYPES.find((t) => t === normalized);
}

/**
 * Normalizes a string value to a valid claim classification.
 * Returns undefined if the value is not a recognized classification.
 *
 * @param classification - The string value to normalize
 * @returns The normalized classification or undefined
 *
 * @example
 * ```ts
 * const normalized = normalizeClaimClassification('FACT'); // returns 'fact'
 * const invalid = normalizeClaimClassification('unknown'); // returns undefined
 * ```
 */
export function normalizeClaimClassification(
  classification: string | undefined
): (typeof CLAIM_CLASSIFICATIONS)[number] | undefined {
  if (!classification) return undefined;
  const normalized = classification.toLowerCase();
  return CLAIM_CLASSIFICATIONS.find((c) => c === normalized);
}
