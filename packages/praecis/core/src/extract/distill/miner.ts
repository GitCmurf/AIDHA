// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 Colin Farmer (GitCmurf)

import type { Result } from '@aidha/taxonomy';
import type { ICandidateMiner, MiningRequest, MiningResult } from '../../interfaces/index.js';
import type { LlmCompletionRequest, LlmCompletionResult } from '../llm-client.js';
import { estimateTokens } from '../token-budget.js';
import { consoleLogger, type Logger } from '../../utils/logger.js';
import { parseSourceDistillation, distillationResponseSchema } from './schema.js';
import { verifyDistillationEvidence } from './quote-verification.js';
import { prepareSegmentedEvidence, SEGMENTED_EVIDENCE_VERSION } from './segmented-evidence.js';
import { computeCoverage } from './coverage.js';
import type { RejectedUnit } from './grounding.js';
import { buildSegmentedGroundingReview, finalizeGroundingAdmission, rejectSegmentRepairs } from './grounding-admission.js';
import { buildDistillationOutput } from './report.js';
import { applyLimitationRelations, buildLimitationPrompt, limitationResponseSchema, LIMITATION_PROMPT_VERSION,
  parseLimitationRelations } from './limitations.js';
import { hashSnapshotCandidate, parseSnapshotCandidate, SOURCE_DISTILLATION_SNAPSHOT_IDENTITY_VERSION } from './snapshot.js';
import type { SegmentRepairRecord, SourceLimitationSummary } from '../../interfaces/index.js';
import { projectUnit, type ExtractionIntent } from './projection.js';
import { buildDistillPrompt, buildRepairPrompt, buildGroundingPrompt, DISTILL_PROMPT_VERSION, GROUNDING_PROMPT_VERSION } from './prompts.js';

export interface SourceDistillationMinerConfig {
  readonly extractionIntent?: ExtractionIntent;
  readonly enableLimitationApplicability?: boolean;
  readonly enableSegmentedEvidence?: boolean;
  readonly quoteFailureCloseThreshold?: number;
  readonly logger?: Logger;
}

/** Budget preflight failed before another model call; optional links may be skipped. */
class PreflightBudgetUnavailable extends Error {}

/** Explicitly injectable two-pass miner; default pipeline selection is separate. */
export class SourceDistillationMiner implements ICandidateMiner {
  readonly extractionSnapshotVersion = 1 as const;
  private readonly intent: ExtractionIntent;
  private readonly threshold: number;
  private readonly enableLimitationApplicability: boolean;
  private readonly enableSegmentedEvidence: boolean;
  private readonly logger: Logger;

  constructor(config: SourceDistillationMinerConfig = {}) {
    this.intent = config.extractionIntent ?? 'knowledge_graph';
    this.threshold = config.quoteFailureCloseThreshold ?? 0.3;
    this.enableLimitationApplicability = config.enableLimitationApplicability ?? false;
    this.enableSegmentedEvidence = config.enableSegmentedEvidence ?? false;
    if (!Number.isFinite(this.threshold) || this.threshold < 0 || this.threshold > 1) {
      throw new RangeError('quoteFailureCloseThreshold must be between zero and one');
    }
    this.logger = config.logger ?? consoleLogger;
  }

  get cacheIdentity(): string {
    return JSON.stringify({ version: SOURCE_DISTILLATION_SNAPSHOT_IDENTITY_VERSION, prompt: DISTILL_PROMPT_VERSION,
      grounding: GROUNDING_PROMPT_VERSION, limitation: this.enableLimitationApplicability ? LIMITATION_PROMPT_VERSION : null,
      ...(this.enableSegmentedEvidence ? { segmentedEvidence: SEGMENTED_EVIDENCE_VERSION } : {}),
      intent: this.intent, threshold: this.threshold });
  }

  async mine(request: MiningRequest): Promise<Result<MiningResult>> {
    const llm = request.llm;
    const model = request.config.llm?.model;
    if (!llm || !model) return { ok: false, error: new Error('Source distillation requires an LLM client and model') };
    const ids = request.chunks.map(chunk => chunk.id);
    if (!ids.length || ids.some(id => !id.trim()) || new Set(ids).size !== ids.length) {
      return { ok: false, error: new Error('Source distillation requires nonempty chunks with unique nonblank IDs') };
    }
    if (request.costCeiling.maxSpendUsd !== undefined) {
      return { ok: false, error: new Error('Source distillation cannot enforce dollar ceilings with a token-usage-only LLM client') };
    }
    const ceiling = request.costCeiling.maxTokens;
    if (ceiling !== undefined && (!Number.isFinite(ceiling) || ceiling < 0)) {
      return { ok: false, error: new Error('Token ceiling must be finite and nonnegative') };
    }
    let totalTokens = 0;
    let usageUnknown = false;
    const diagnostics: string[] = [];
    let segmentRepairs: SegmentRepairRecord[] = [];
    const failClosed = (reason: string): Result<MiningResult> => {
      this.logger.warn(`[DISTILL] ${reason}`);
      segmentRepairs = rejectSegmentRepairs(segmentRepairs);
      return { ok: true, value: { claims: [], rejectedClaims: [], supportingUnits: [], tokenUsage: totalTokens,
        distillation: { failedClosed: true, diagnostics: [...diagnostics, reason],
          ...(segmentRepairs.length ? { segmentRepairs } : {}) } } };
    };
    const generate = async (prompt: Pick<LlmCompletionRequest, 'system' | 'user' | 'responseFormat'>): Promise<LlmCompletionResult> => {
      // maxTokens limits completion output; reserve estimated prompt/schema input too.
      // Tokenization is provider-specific: this is a preflight guard, not a billing cap.
      if (ceiling !== undefined && usageUnknown) throw new PreflightBudgetUnavailable('Cannot continue a token-limited run without reported usage');
      const inputEstimate = estimateTokens(`${prompt.system}\n${prompt.user}\n${JSON.stringify(prompt.responseFormat ?? {})}`);
      const remaining = ceiling === undefined ? 16_000 : Math.min(16_000, Math.floor(ceiling - totalTokens - inputEstimate));
      if (remaining <= 0) throw new PreflightBudgetUnavailable('Token ceiling cannot cover the next estimated prompt and completion');
      let result: LlmCompletionResult;
      try {
        result = await llm.generate({ ...prompt, model, maxTokens: remaining,
          reasoningEffort: request.config.llm.reasoningEffort, verbosity: request.config.llm.verbosity });
      } catch (error) {
        result = { ok: false, error: error instanceof Error ? error : new Error(String(error)) };
      }
      if (result.usage) {
        const used = result.usage.totalTokens;
        if (!Number.isFinite(used) || used < 0) throw new Error('Provider returned invalid token usage');
        totalTokens += used;
      } else {
        diagnostics.push('Provider did not report usage for this call; tokenUsage includes reported tokens only.');
        usageUnknown = true;
      }
      if (ceiling !== undefined && totalTokens > ceiling) throw new Error('Reported token usage exceeded the token ceiling');
      return result;
    };

    try {
      const knownIds = new Set(ids);
      const excerpts = new Map(request.chunks.map(chunk => [chunk.id, chunk.text]));
      const prompt = buildDistillPrompt({ resourceLabel: request.raw.label ?? request.raw.canonicalId, extractionIntent: this.intent },
        request.chunks.map(chunk => ({ id: chunk.id, text: chunk.text,
          startSeconds: chunk.locator.kind === 'timecode' ? chunk.locator.startSec : 0 })));
      const responseFormat = { type: 'json_schema' as const, schema: distillationResponseSchema(knownIds) };
      const generated = await generate({ ...prompt, responseFormat });
      if (!generated.ok) return failClosed(`Generation transport failure: ${generated.error.message}`);
      let parsed = parseSourceDistillation(generated.value, knownIds);
      if (!parsed.ok) {
        const repaired = await generate({ ...buildRepairPrompt(prompt, generated.value, parsed.errors), responseFormat });
        if (!repaired.ok) return failClosed(`Schema repair transport failure: ${repaired.error.message}`);
        parsed = parseSourceDistillation(repaired.value, knownIds);
        if (!parsed.ok) return failClosed(`Schema invalid after one repair: ${parsed.errors.join('; ')}`);
      }
      const proposal = parsed.value;
      const verified = verifyDistillationEvidence(proposal.units, excerpts);
      const segmented = this.enableSegmentedEvidence
        ? prepareSegmentedEvidence(verified.units, excerpts) : { repaired: [], records: [] };
      segmentRepairs = segmented.records;
      const replacements = new Map(segmented.repaired.map(unit => [unit.id, unit]));
      const failedIds = new Set(verified.failedUnitIds.filter(id => !replacements.has(id)));
      const rejected: RejectedUnit[] = verified.units.filter(unit => failedIds.has(unit.id))
        .map(unit => ({ unit, reason: 'failed_quote_verification' }));
      const failureRatio = verified.units.length ? failedIds.size / verified.units.length : 0;
      if (failureRatio > this.threshold) return failClosed('Quote verification failure ratio exceeds the configured threshold');
      const provisional = verified.units.filter(unit => !failedIds.has(unit.id)).map(unit => replacements.get(unit.id) ?? unit);
      let grounding: LlmCompletionResult | undefined;
      if (provisional.length) {
        const groundingPrompt = buildGroundingPrompt(provisional, excerpts);
        const review = buildSegmentedGroundingReview(segmentRepairs);
        grounding = await generate({ ...groundingPrompt,
          user: [groundingPrompt.user, review].filter(Boolean).join('\n\n') });
      }
      const admission = finalizeGroundingAdmission({ originalUnits: verified.units, failedUnitIds: failedIds,
        replacements, kept: provisional, rejected, segmentRepairs, grounding, threshold: this.threshold });
      segmentRepairs = [...admission.segmentRepairs];
      diagnostics.push(...admission.diagnostics);
      if (admission.closeReason) return failClosed(admission.closeReason);
      const kept = admission.kept;
      const finalRejected = admission.rejected;
      const affirmativeGroundingIds = admission.affirmativeGroundingIds;
      let limitationsByTarget: ReadonlyMap<string, readonly SourceLimitationSummary[]> = new Map();
      const isGroundedClaim = (unit: typeof kept[number]): boolean => affirmativeGroundingIds.has(unit.id) &&
        projectUnit(this.intent, proposal.sourceType, unit.kind, unit.importance) === 'claim';
      if (this.enableLimitationApplicability && kept.some(unit => unit.kind === 'limitation' && isGroundedClaim(unit)) &&
          kept.some(unit => unit.kind !== 'limitation' && isGroundedClaim(unit))) {
        try {
          const judged = await generate({ ...buildLimitationPrompt(kept, excerpts),
            responseFormat: { type: 'json_schema', schema: limitationResponseSchema() } });
          if (!judged.ok) diagnostics.push(`Limitation applicability transport failure (links skipped): ${judged.error.message}`);
          else {
            const parsedRelations = parseLimitationRelations(judged.value);
            if (!parsedRelations.ok) diagnostics.push(`Limitation applicability parse failure (links skipped): ${parsedRelations.errors.join('; ')}`);
            else {
              diagnostics.push(...parsedRelations.errors);
              const applied = applyLimitationRelations(kept, parsedRelations.value, excerpts,
                affirmativeGroundingIds, this.intent, proposal.sourceType);
              limitationsByTarget = applied.byTarget;
              diagnostics.push(...applied.diagnostics);
            }
          }
        } catch (error) {
          // Only a pre-call budget decision may omit the optional links. Usage
          // invariants and other post-call exceptions still fail the run closed.
          if (!(error instanceof PreflightBudgetUnavailable)) throw error;
          diagnostics.push(`Limitation applicability unavailable (links skipped): ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      const coverageExcerpts = request.chunks.map(chunk => ({ id: chunk.id, text: chunk.text,
        ...(chunk.locator.kind === 'timecode' ? { startSec: chunk.locator.startSec, endSec: chunk.locator.endSec } : {}) }));
      const coverage = computeCoverage(kept, coverageExcerpts);
      const output = buildDistillationOutput({ extractionIntent: this.intent,
        sourceType: proposal.sourceType, sourcePurpose: proposal.sourcePurpose, sourceCoherence: proposal.sourceCoherence,
        theses: proposal.theses, units: kept, rejectedUnits: finalRejected,
        limitationsByTarget,
        coverage: { ...coverage, weakQuoteCount: coverage.weakQuoteCount + verified.weakQuoteCount },
        diagnostics, segmentRepairs, model, promptVersion: DISTILL_PROMPT_VERSION });
      const extractionSnapshotCandidate = parseSnapshotCandidate({
        schemaVersion: 1, trusted: false, sourceCanonicalId: request.raw.canonicalId, extractionIntent: this.intent,
        minerIdentity: this.cacheIdentity, model, promptVersion: DISTILL_PROMPT_VERSION,
        preProjectionDiagnostics: diagnostics, proposal, finalUnits: kept, rejectedUnits: finalRejected,
        limitationApplicability: { affirmativeGroundingIds: kept.filter(unit => affirmativeGroundingIds.has(unit.id)).map(unit => unit.id),
          limitationsByTarget: Object.fromEntries(limitationsByTarget) },
        supportingUnits: output.supportingUnits, report: output.distillation,
      });
      if (!extractionSnapshotCandidate) return failClosed('Could not validate the complete extraction snapshot');
      return { ok: true, value: { ...output, extractionSnapshotCandidate,
        extractionSnapshotCandidateHash: hashSnapshotCandidate(extractionSnapshotCandidate), tokenUsage: totalTokens,
        distillation: { ...output.distillation, failedClosed: false } } };
    } catch (error) {
      return failClosed(error instanceof Error ? error.message : String(error));
    }
  }
}
