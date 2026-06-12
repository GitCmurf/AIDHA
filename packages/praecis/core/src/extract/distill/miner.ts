// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 Colin Farmer (GitCmurf)

import type { Result } from '@aidha/taxonomy';
import type { ICandidateMiner, MiningRequest, MiningResult, DraftClaim, SupportingUnitSummary, SourceDistillationSummary } from '../../interfaces/index.js';
import type { LlmTokenUsage } from '../llm-client.js';
import { estimateTokens } from '../token-budget.js';
import { consoleLogger, type Logger } from '../../utils/logger.js';
import { parseSourceDistillation } from './schema.js';
import { verifyDistillationEvidence } from './quote-verification.js';
import type { VerifiedUnit } from './quote-verification.js';
import { computeCoverage, type CoverageExcerpt } from './coverage.js';
import { applyGroundingVerdicts, parseGroundingVerdicts, type RejectedUnit } from './grounding.js';
import { applyConsolidation, parseConsolidationRelations } from './consolidation.js';
import { buildDistillationOutput } from './report.js';
import type { ExtractionIntent } from './projection.js';
import {
  buildConsolidationPrompt,
  buildDistillPrompt,
  buildGroundingPrompt,
  buildRepairPrompt,
  buildSectionNotesPrompt,
  DISTILL_PROMPT_VERSION,
  type ExcerptPayload,
  type PromptOutput,
} from './prompts.js';

export interface SourceDistillationMinerConfig {
  readonly extractionIntent?: ExtractionIntent;
  /** Quote-verification failure ratio above which the run fails closed. */
  readonly quoteFailureCloseThreshold?: number;
  /** Token estimate above which the Pass 0 section-notes path activates. */
  readonly sectionNotesTokenThreshold?: number;
  /** Tokens per Pass 0 section. */
  readonly sectionNotesSectionTokens?: number;
  /** Experiments only; never default. Proceeds with partial output instead of failing closed. */
  readonly allowPartial?: boolean;
  readonly logger?: Logger;
}

const DEFAULT_QUOTE_FAILURE_CLOSE_THRESHOLD = 0.3;
const DEFAULT_SECTION_NOTES_TOKEN_THRESHOLD = 30_000;
const DEFAULT_SECTION_NOTES_SECTION_TOKENS = 8_000;

export class SourceDistillationMiner implements ICandidateMiner {
  private readonly extractionIntent: ExtractionIntent;
  private readonly quoteFailureCloseThreshold: number;
  private readonly sectionNotesTokenThreshold: number;
  private readonly sectionNotesSectionTokens: number;
  private readonly allowPartial: boolean;
  private readonly logger: Logger;

  constructor(config: SourceDistillationMinerConfig = {}) {
    this.extractionIntent = config.extractionIntent ?? 'knowledge_graph';
    this.quoteFailureCloseThreshold = config.quoteFailureCloseThreshold ?? DEFAULT_QUOTE_FAILURE_CLOSE_THRESHOLD;
    this.sectionNotesTokenThreshold = config.sectionNotesTokenThreshold ?? DEFAULT_SECTION_NOTES_TOKEN_THRESHOLD;
    this.sectionNotesSectionTokens = config.sectionNotesSectionTokens ?? DEFAULT_SECTION_NOTES_SECTION_TOKENS;
    this.allowPartial = config.allowPartial ?? false;
    this.logger = config.logger ?? consoleLogger;
  }

  estimate(request: MiningRequest): Result<{ readonly tokenUsage: number; readonly spendUsd: number }> {
    const transcriptTokens = request.chunks.reduce((sum, chunk) => sum + estimateTokens(chunk.text), 0);
    // distill (transcript) + grounding (units + cited excerpts) + consolidation (unit texts)
    return { ok: true, value: { tokenUsage: Math.ceil(transcriptTokens * 1.8), spendUsd: 0 } };
  }

  async mine(request: MiningRequest): Promise<Result<MiningResult>> {
    // 1. Guards
    if (!request.llm) {
      return { ok: false, error: new Error('[DISTILL] No LLM client provided in MiningRequest.') };
    }
    const model = request.config?.llm?.model;
    if (!model) {
      return { ok: false, error: new Error('[DISTILL] No LLM model configured in request.config.llm.model.') };
    }

    const llm = request.llm;
    let totalTokens = 0;
    const diagnostics: string[] = [];

    /** Accumulate usage from an LLM response */
    function accumulateUsage(usage: LlmTokenUsage | undefined): void {
      if (usage) totalTokens += usage.totalTokens;
    }

    /** Build fail-closed result */
    const failClosed = (reasons: string[]): Result<MiningResult> => {
      this.logger.warn(`[DISTILL] Failing closed: ${reasons.join('; ')}`);
      return {
        ok: true,
        value: {
          claims: [],
          rejectedClaims: [],
          supportingUnits: [],
          tokenUsage: totalTokens,
          distillation: {
            failedClosed: true,
            diagnostics: [...diagnostics, ...reasons],
          },
        },
      };
    };

    // 2. Build ExcerptPayload[] and CoverageExcerpt[] from chunks
    const excerptPayloads: ExcerptPayload[] = request.chunks.map(chunk => {
      const startSeconds = chunk.locator.kind === 'timecode' ? chunk.locator.startSec : 0;
      return { id: chunk.id, startSeconds, text: chunk.text };
    });

    const coverageExcerpts: CoverageExcerpt[] = request.chunks.map(chunk => {
      if (chunk.locator.kind === 'timecode') {
        return { id: chunk.id, text: chunk.text, startSec: chunk.locator.startSec, endSec: chunk.locator.endSec };
      }
      return { id: chunk.id, text: chunk.text };
    });

    const excerptTextById = new Map<string, string>(request.chunks.map(chunk => [chunk.id, chunk.text]));
    const knownExcerptIds = new Set(request.chunks.map(chunk => chunk.id));
    const resourceLabel = (request.raw as { label?: string }).label ?? request.raw.canonicalId;

    // 3. Pass 0: section notes for large transcripts
    let sectionNotes: string | undefined;
    const totalTranscriptTokens = excerptPayloads.reduce((sum, ep) => sum + estimateTokens(ep.text), 0);

    if (totalTranscriptTokens > this.sectionNotesTokenThreshold) {
      // Split excerpts into sections of ~sectionNotesSectionTokens
      const sections: ExcerptPayload[][] = [];
      let currentSection: ExcerptPayload[] = [];
      let currentTokens = 0;

      for (const ep of excerptPayloads) {
        const epTokens = estimateTokens(ep.text);
        if (currentSection.length > 0 && currentTokens + epTokens > this.sectionNotesSectionTokens) {
          sections.push(currentSection);
          currentSection = [ep];
          currentTokens = epTokens;
        } else {
          currentSection.push(ep);
          currentTokens += epTokens;
        }
      }
      if (currentSection.length > 0) sections.push(currentSection);

      const sectionNotesParts: string[] = [];
      for (let i = 0; i < sections.length; i++) {
        const sectionPrompt = buildSectionNotesPrompt(
          { resourceLabel, sectionIndex: i, sectionCount: sections.length },
          sections[i]!
        );
        const sectionResult = await llm.generate({ model, system: sectionPrompt.system, user: sectionPrompt.user });
        accumulateUsage(sectionResult.usage);
        if (!sectionResult.ok) {
          return failClosed([`Pass 0 section ${i + 1}/${sections.length} LLM transport failure: ${sectionResult.error.message}`]);
        }
        sectionNotesParts.push(sectionResult.value);
      }
      sectionNotes = sectionNotesParts.join('\n\n');
      diagnostics.push(`Pass 0: ${sections.length} section(s), ~${totalTranscriptTokens} transcript tokens.`);
    }

    // 4. Pass 1: distillation
    const distillPrompt: PromptOutput = buildDistillPrompt(
      { resourceLabel, extractionIntent: this.extractionIntent, sectionNotes },
      excerptPayloads
    );

    const distillResult = await llm.generate({ model, system: distillPrompt.system, user: distillPrompt.user });
    accumulateUsage(distillResult.usage);

    if (!distillResult.ok) {
      return failClosed([`Pass 1 LLM transport failure: ${distillResult.error.message}`]);
    }

    let parsedDistillation = parseSourceDistillation(distillResult.value, knownExcerptIds);

    if (!parsedDistillation.ok) {
      // One repair retry
      const repairPrompt = buildRepairPrompt(distillPrompt, distillResult.value, parsedDistillation.errors);
      const repairResult = await llm.generate({ model, system: repairPrompt.system, user: repairPrompt.user });
      accumulateUsage(repairResult.usage);

      if (!repairResult.ok) {
        return failClosed([`Pass 1 repair LLM transport failure: ${repairResult.error.message}`]);
      }

      parsedDistillation = parseSourceDistillation(repairResult.value, knownExcerptIds);
      if (!parsedDistillation.ok) {
        return failClosed([`Pass 1 schema validation failed after repair: ${parsedDistillation.errors.join('; ')}`]);
      }
    }

    const distillation = parsedDistillation.value;

    // 5. Deterministic quote verification
    const verificationResult = verifyDistillationEvidence(distillation.units, excerptTextById);
    const failedIdSet = new Set(verificationResult.failedUnitIds);

    const quoteRejected: RejectedUnit[] = verificationResult.units
      .filter(u => failedIdSet.has(u.id))
      .map(u => ({ unit: u, reason: 'failed_quote_verification' as const }));

    const verifiedUnits: VerifiedUnit[] = verificationResult.units.filter(u => !failedIdSet.has(u.id));

    if (verificationResult.failureRatio > this.quoteFailureCloseThreshold && !this.allowPartial) {
      const pct = Math.round(verificationResult.failureRatio * 100);
      return failClosed([
        `Quote verification failed for ${pct}% of units (threshold ${Math.round(this.quoteFailureCloseThreshold * 100)}%). Failing closed to avoid hallucinated claims.`,
      ]);
    }

    // 6. Pass 2a: grounding (advisory)
    let keptUnits: VerifiedUnit[] = verifiedUnits;
    let groundingRejected: RejectedUnit[] = [];
    let groundingDiagnostics: string[] = [];

    if (verifiedUnits.length > 0) {
      const groundingPrompt = buildGroundingPrompt(verifiedUnits, excerptTextById);
      const groundingResult = await llm.generate({ model, system: groundingPrompt.system, user: groundingPrompt.user });
      accumulateUsage(groundingResult.usage);

      if (!groundingResult.ok) {
        diagnostics.push(`Pass 2a grounding LLM transport failure (advisory); keeping all verified units: ${groundingResult.error.message}`);
      } else {
        const parsedVerdicts = parseGroundingVerdicts(groundingResult.value);
        if (!parsedVerdicts.ok) {
          diagnostics.push(`Pass 2a grounding parse failure (advisory); keeping all verified units: ${parsedVerdicts.errors.join('; ')}`);
        } else {
          const application = applyGroundingVerdicts(verifiedUnits, parsedVerdicts.value);
          keptUnits = [...application.kept];
          groundingRejected = [...application.rejected];
          groundingDiagnostics = [...application.diagnostics];
        }
      }
    }

    // 7. Pass 2b: consolidation (advisory, only if >1 unit)
    let consolidatedUnits = applyConsolidation(keptUnits, []);
    let recordedRelations = consolidatedUnits.recordedRelations;

    if (keptUnits.length > 1) {
      const consolidationPrompt = buildConsolidationPrompt(keptUnits);
      const consolidationResult = await llm.generate({ model, system: consolidationPrompt.system, user: consolidationPrompt.user });
      accumulateUsage(consolidationResult.usage);

      if (!consolidationResult.ok) {
        diagnostics.push(`Pass 2b consolidation LLM transport failure (advisory); skipping: ${consolidationResult.error.message}`);
      } else {
        const parsedRelations = parseConsolidationRelations(consolidationResult.value);
        if (!parsedRelations.ok) {
          diagnostics.push(`Pass 2b consolidation parse failure (advisory); skipping: ${parsedRelations.errors.join('; ')}`);
        } else {
          consolidatedUnits = applyConsolidation(keptUnits, parsedRelations.value);
          recordedRelations = consolidatedUnits.recordedRelations;
          diagnostics.push(...consolidatedUnits.diagnostics);
        }
      }
    }

    // Fold in grounding diagnostics
    diagnostics.push(...groundingDiagnostics);

    // 8. Coverage
    const coverage = computeCoverage(consolidatedUnits.units, coverageExcerpts);

    // 9. Build output
    const output = buildDistillationOutput({
      extractionIntent: this.extractionIntent,
      sourceType: distillation.sourceType,
      sourcePurpose: distillation.sourcePurpose,
      sourceCoherence: distillation.sourceCoherence,
      theses: distillation.theses,
      units: consolidatedUnits.units,
      rejectedUnits: [...quoteRejected, ...groundingRejected],
      recordedRelations,
      coverage,
      diagnostics,
      model,
      promptVersion: DISTILL_PROMPT_VERSION,
    });

    // 10. Map to MiningResult
    const distillationSummary: SourceDistillationSummary = {
      failedClosed: false,
      sourceType: output.distillation.sourceType,
      sourcePurpose: output.distillation.sourcePurpose,
      sourceCoherence: output.distillation.sourceCoherence,
      theses: output.distillation.theses,
      coverage: output.distillation.coverage,
      unitCountsByKind: output.distillation.unitCountsByKind,
      relations: output.distillation.relations,
      diagnostics: output.distillation.diagnostics,
    };

    const supportingUnits: SupportingUnitSummary[] = output.supportingUnits.map(su => ({
      id: su.id,
      kind: su.kind,
      text: su.text,
      supportsUnitIds: su.supportsUnitIds,
      excerptIds: su.excerptIds,
    }));

    return {
      ok: true,
      value: {
        claims: output.claims,
        rejectedClaims: output.rejectedClaims,
        supportingUnits,
        tokenUsage: totalTokens,
        distillation: distillationSummary,
      },
    };
  }
}
