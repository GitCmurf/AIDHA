---
document_id: AIDHA-TASK-005
owner: Ingestion Engineering Lead
status: Draft
version: "1.0"
last_updated: 2026-03-05
title: Deferred Claim Extraction Improvements
type: TASK
docops_version: "2.0"
---

<!-- MEMINIT_METADATA_BLOCK -->

> **Document ID:** AIDHA-TASK-005
> **Owner:** Ingestion Engineering Lead
> **Status:** Draft
> **Version:** 1.0
> **Last Updated:** 2026-03-05
> **Type:** TASK

# Task 005: Deferred Claim Extraction Improvements

**Status:** Pending
**Priority:** Medium
**Type:** Refactoring & Code Quality
**Epic:** Code Review Feedback Accumulation

## Version History

| Version | Date       | Author | Change Summary | Reviewers | Status | Reference |
| ------- | ---------- | ------ | -------------- | --------- | ------ | --------- |
| 1.0     | 2026-03-05 | AI     | Initial release documenting deferred improvements from code review rounds 1-2. | — | Draft | — |

## Overview

This task captures valuable improvements identified during code review rounds that
were deferred due to their cumulative scope. Each item is technically sound but was
not addressed immediately to avoid scope creep.

## Motivation

Multiple code review rounds identified legitimate improvements across:

- Code quality and maintainability
- Performance optimization opportunities
- Documentation accuracy
- Type safety and validation

These items represent technical debt that should be addressed systematically.

---

## A. Verification Module Improvements

### A.1. Replace Massive COMMON_NOUNS Set

**File:** `packages/praecis/youtube/src/extract/verification.ts` (lines 116-118)

**Issue:** The `COMMON_NOUNS` set contains 1,000+ words, many unrelated to
health/physiology content (e.g., 'katana', 'wetsuit', 'burkini', 'monokini',
'prison', 'jeans', 'dungarees'). Contains duplicate entries.

**Impact:**

- Makes file nearly impossible to review or maintain
- Risks classifying domain-specific keywords as "common" when they should surface
  as meaningful
- Unnecessary memory overhead

**Proposed Solution:**
Replace with curated set of ~50-100 genuinely generic nouns that are poor
health-domain discriminators:

```typescript
const COMMON_NOUNS = new Set([
  // Abstract/conceptual
  'thing', 'part', 'way', 'point', 'result', 'case', 'type', 'example', 'area', 'level',
  'factor', 'aspect', 'feature', 'item', 'object', 'element', 'issue', 'problem', 'question',
  // Time/quantity
  'time', 'moment', 'period', 'phase', 'stage', 'step', 'amount', 'number', 'quantity',
  'count', 'rate', 'ratio', 'score', 'value', 'cost', 'weight', 'size',
  // Containers/structures
  'group', 'set', 'collection', 'list', 'series', 'range', 'variety', 'sort', 'kind',
  'form', 'shape', 'class', 'category', 'section', 'segment', 'portion', 'piece',
  // ... ~50 total words
]);
```

**Acceptance Criteria:**

- [ ] COMMON_NOUNS reduced to ≤100 words
- [ ] All entries are genuinely generic (not domain-specific)
- [ ] No duplicate entries
- [ ] File is human-readable and maintainable
- [ ] All tests pass

---

### A.2. Unify Entailment Scaling for Custom Configs

**File:** `packages/praecis/youtube/src/extract/verification.ts`

**Issue:** Custom configs can desync thresholds when only `semanticThreshold` is
overridden. The hardcoded `0.8` scaling at line 267 should use
`ENTAILMENT_SCALING_FACTOR`.

**Current Code (lines 153-155):**

```typescript
constructor(config?: Partial<VerificationConfig>) {
  this.config = { ...DEFAULT_CONFIG, ...config };
}
```

**Proposed Solution:**

```typescript
constructor(config: Partial<VerificationConfig> = {}) {
  const lexicalThreshold = config.lexicalThreshold ?? DEFAULT_CONFIG.lexicalThreshold;
  const semanticThreshold = config.semanticThreshold ?? DEFAULT_CONFIG.semanticThreshold;
  const entailmentThreshold = config.entailmentThreshold ??
    semanticThreshold * ENTAILMENT_SCALING_FACTOR;

  this.config = { lexicalThreshold, semanticThreshold, entailmentThreshold };
}
```

Also update line 267:

```typescript
- const entailmentScore = Math.min(1, semanticResult.similarity * 0.8);
+ const entailmentScore = Math.min(1, semanticResult.similarity * ENTAILMENT_SCALING_FACTOR);
```

**Acceptance Criteria:**

- [ ] Custom configs with `semanticThreshold` override derive correct
  `entailmentThreshold`
- [ ] Hardcoded `0.8` replaced with `ENTAILMENT_SCALING_FACTOR` constant
- [ ] All tests pass

---

### A.3. Hoist Claim Phrase Extraction

**File:** `packages/praecis/youtube/src/extract/verification.ts` (lines 216-224)

**Issue:** `extractKeyPhrases(claim)` is recomputed per source in the loop.
It's loop-invariant.

**Current Code:**

```typescript
for (const source of sources) {
  const claimPhrases = extractKeyPhrases(claim);  // Recomputed every iteration
  const sourcePhrases = extractKeyPhrases(source);
  // ...
}
```

**Proposed Solution:**

```typescript
let maxSimilarity = 0;
const claimPhrases = extractKeyPhrases(claim);  // Compute once

for (const source of sources) {
  const sourcePhrases = extractKeyPhrases(source);
  // ...
}
```

**Acceptance Criteria:**

- [ ] `extractKeyPhrases(claim)` called once before source loop
- [ ] No functional changes to verification results
- [ ] All tests pass

---

### A.4. Validate `n` Parameter in calculateNGramOverlap

**File:** `packages/praecis/youtube/src/extract/verification.ts` (line 405)

**Issue:** `n` parameter is externally controllable but unchecked. With `n <= 0`,
behavior is incorrect.

**Proposed Solution:**

```typescript
export function calculateNGramOverlap(text1: string, text2: string, n = 2): number {
  if (!Number.isInteger(n) || n < 1) {
    throw new RangeError('n must be a positive integer');
  }
  // ... rest of function
}
```

Also update `extractNgrams`:

```typescript
function extractNgrams(tokens: string[], n: number): string[] {
  if (n < 1 || tokens.length < n) {
    return [];
  }
  // ... rest of function
}
```

**Acceptance Criteria:**

- [ ] Invalid `n` values throw `RangeError`
- [ ] Edge cases (n=0, negative, non-integer) are handled
- [ ] All tests pass

---

### A.5. Fix Outdated Documentation

**File:** `packages/praecis/youtube/src/extract/verification.ts`

**Issue:** Documentation still references old default of `0.7` for
`entailmentThreshold`, but it's now `0.48`.

**Locations:**

- Line 48: Comment says "default: 0.7"
- Line 136: Example shows `entailmentThreshold: 0.7`

**Proposed Solution:**
Update all references to `0.48` or make them reference the constant.

**Acceptance Criteria:**

- [ ] All documentation matches actual default value
- [ ] Example code reflects current behavior

---

## B. LLM Claims Module Improvements

### B.1. Extract Magic Numbers to Named Constants

**File:** `packages/praecis/youtube/src/extract/llm-claims.ts` (lines 894-904)

**Issue:** Token budget threshold (4000) and cost warning threshold ($0.50) are
hard-coded.

**Proposed Solution:**

```typescript
const TOKEN_BUDGET_WARNING_THRESHOLD = 4000;
const COST_WARNING_THRESHOLD_USD = 0.50;

// ... later in code
if (totalRequestTokens > TOKEN_BUDGET_WARNING_THRESHOLD) {
  console.warn(`[TOKEN-BUDGET] ...`);
}
if (projectedCost > COST_WARNING_THRESHOLD_USD) {
  console.warn(`[COST-WARNING] ...`);
}
```

**Acceptance Criteria:**

- [ ] Constants defined at module level with clear names
- [ ] Hard-coded numbers replaced with references
- [ ] All tests pass

---

### B.2. Clarify Cache Key Guard Condition

**File:** `packages/praecis/youtube/src/extract/llm-claims.ts` (lines 491-493, 832)

**Issue:** `cacheKey !== legacyCacheKey` guard is always true (keys differ by
schema version), making the condition misleading.

**Current Code:**

```typescript
if (!cached && cacheKey !== legacyCacheKey) {
  cached = await readCache(join(cacheDir, `${legacyCacheKey}.json`), metadata);
}
```

**Proposed Solution:**
Replace with clearer comment:

```typescript
// Always check legacy key for backward compatibility
// (keys differ by schema version, so we always try both on miss)
cached = await readCache(join(cacheDir, `${legacyCacheKey}.json`), metadata);
```

**Acceptance Criteria:**

- [ ] Misleading condition removed or clarified
- [ ] Behavior remains identical
- [ ] All tests pass

---

## C. Editorial Ranking Improvements

### C.1. Use DEFAULT_ECHO_DETECTION Constants

**File:** `packages/praecis/youtube/src/extract/editorial-ranking.ts` (lines 665-671)

**Issue:** `echoMode` and `echoThreshold` duplicate defaults from
`DEFAULT_ECHO_DETECTION` instead of reusing.

**Current Code:**

```typescript
const echoMode = options.echoDetection?.mode ?? 'tag';
const echoThreshold = clamp(
  options.echoDetection?.overlapThreshold ?? DEFAULT_V2_ECHO_OVERLAP_THRESHOLD,
```

**Proposed Solution:**

```typescript
const echoMode = options.echoDetection?.mode ?? DEFAULT_ECHO_DETECTION.mode;
const echoThreshold = clamp(
  options.echoDetection?.overlapThreshold ?? DEFAULT_ECHO_DETECTION.overlapThreshold,
```

**Acceptance Criteria:**

- [ ] Uses `DEFAULT_ECHO_DETECTION` constants directly
- [ ] Reduces duplication of default values
- [ ] All tests pass

---

### C.2. Cache V2 Scores in Hot Paths

**File:** `packages/praecis/youtube/src/extract/editorial-ranking.ts` (lines 681-691,
735-754)

**Issue:** `scoreCandidateV2()` is recomputed multiple times during
sorting/dedupe/scoring. A local score cache reduces repeated work.

**Proposed Solution:**

```typescript
const scoreCache = new Map<ClaimCandidate, number>();
const getScore = (candidate: ClaimCandidate): number => {
  const cached = scoreCache.get(candidate);
  if (cached !== undefined) return cached;
  const score = scoreCandidateV2(candidate, scoreOptions);
  scoreCache.set(candidate, score);
  return score;
};
```

**Acceptance Criteria:**

- [ ] Score caching implemented in hot paths
- [ ] Performance improvement measurable for large claim sets
- [ ] All tests pass with identical results

---

## D. Cross-Cutting Improvements

### D.1. Extract Token Budget Constants to Shared Module

**Files:** Multiple modules use token/cost thresholds

**Issue:** Token budget and cost thresholds are scattered across files.

**Proposed Solution:**
Create shared constants in `token-budget.ts`:

```typescript
export const TOKEN_BUDGET_WARNING_THRESHOLD = 4000;
export const COST_WARNING_THRESHOLD_USD = 0.50;
```

**Acceptance Criteria:**

- [ ] Constants exported from `token-budget.ts`
- [ ] All modules import from shared location
- [ ] All tests pass

---

## Implementation Notes

### Priority Order

Suggested implementation order:

1. **A.2** (Unify entailment scaling) - Critical for correctness
2. **A.4** (Validate n parameter) - Prevents incorrect behavior
3. **A.1** (Replace COMMON_NOUNS) - High maintainability impact
4. **B.1** (Extract magic numbers) - Low risk, high clarity
5. **A.3** (Hoist phrase extraction) - Minor performance
6. **B.2** (Clarify cache guard) - Documentation only
7. **C.1** (Use DEFAULT_ECHO_DETECTION) - Minor refactor
8. **A.5** (Fix documentation) - Documentation only
9. **C.2** (Cache V2 scores) - Performance optimization
10. **D.1** (Shared constants) - Organizational improvement

### Testing Strategy

Each item should:

1. Have tests before change (if applicable)
2. Maintain test coverage after change
3. Include targeted tests for new validation/error conditions

## References

- Related: Task 003 (Extraction Quality Atomic Breakdown)
- Related: Task 004 (Claim Extraction Evaluation Matrix)
- Code Review Round 1: LLM claims, circuit breaker, NLP utilities
- Code Review Round 2: Verification, editorial ranking, token budget
