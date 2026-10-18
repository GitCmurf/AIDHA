// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 Colin Farmer (GitCmurf)

import type { Result } from '@aidha/taxonomy';
import type { ICandidateMiner, MiningRequest, MiningResult } from '../../interfaces/index.js';
import type { LlmCompletionRequest, LlmCompletionResult } from '../llm-client.js';
import { estimateTokens } from '../token-budget.js';
import { consoleLogger, type Logger } from '../../utils/logger.js';
import { parseSourceDistillation, distillationResponseSchema } from './schema.js';
import { verifyDistillationEvidence } from './quote-verification.js';
import { computeCoverage } from './coverage.js';
import { applyGroundingVerdicts, parseGroundingVerdicts, type RejectedUnit } from './grounding.js';
import { buildDistillationOutput } from './report.js';
import type { ExtractionIntent } from './projection.js';
import { buildDistillPrompt, buildRepairPrompt, buildGroundingPrompt, DISTILL_PROMPT_VERSION, GROUNDING_PROMPT_VERSION } from './prompts.js';

export interface SourceDistillationMinerConfig {
  readonly extractionIntent?: ExtractionIntent;
  readonly quoteFailureCloseThreshold?: number;
  readonly logger?: Logger;
}

/** Explicitly injectable two-pass miner; default pipeline selection is separate. */
export class SourceDistillationMiner implements ICandidateMiner {
  private readonly intent: ExtractionIntent;
  private readonly threshold: number;
  private readonly logger: Logger;

  constructor(config: SourceDistillationMinerConfig = {}) {
    this.intent = config.extractionIntent ?? 'knowledge_graph';
    this.threshold = config.quoteFailureCloseThreshold ?? 0.3;
    if (!Number.isFinite(this.threshold) || this.threshold < 0 || this.threshold > 1) {
      throw new RangeError('quoteFailureCloseThreshold must be between zero and one');
    }
    this.logger = config.logger ?? consoleLogger;
  }

  get cacheIdentity(): string {
    return JSON.stringify({ version: 'bounded-distillation-v1', prompt: DISTILL_PROMPT_VERSION,
      grounding: GROUNDING_PROMPT_VERSION, intent: this.intent, threshold: this.threshold });
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
    const failClosed = (reason: string): Result<MiningResult> => {
      this.logger.warn(`[DISTILL] ${reason}`);
      return { ok: true, value: { claims: [], rejectedClaims: [], supportingUnits: [], tokenUsage: totalTokens,
        distillation: { failedClosed: true, diagnostics: [...diagnostics, reason] } } };
    };
    const generate = async (prompt: Pick<LlmCompletionRequest, 'system' | 'user' | 'responseFormat'>): Promise<LlmCompletionResult> => {
      // maxTokens limits completion output; reserve estimated prompt/schema input too.
      // Tokenization is provider-specific: this is a preflight guard, not a billing cap.
      if (ceiling !== undefined && usageUnknown) throw new Error('Cannot continue a token-limited run without reported usage');
      const inputEstimate = estimateTokens(`${prompt.system}\n${prompt.user}\n${JSON.stringify(prompt.responseFormat ?? {})}`);
      const remaining = ceiling === undefined ? 16_000 : Math.min(16_000, Math.floor(ceiling - totalTokens - inputEstimate));
      if (remaining <= 0) throw new Error('Token ceiling cannot cover the next estimated prompt and completion');
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
      const failedIds = new Set(verified.failedUnitIds);
      const rejected: RejectedUnit[] = verified.units.filter(unit => failedIds.has(unit.id))
        .map(unit => ({ unit, reason: 'failed_quote_verification' }));
      if (verified.failureRatio > this.threshold) return failClosed('Quote verification failure ratio exceeds the configured threshold');
      let kept = verified.units.filter(unit => !failedIds.has(unit.id));
      if (kept.length) {
        const judged = await generate(buildGroundingPrompt(kept, excerpts));
        if (!judged.ok) diagnostics.push(`Grounding transport failure (advisory); retaining untrusted drafts: ${judged.error.message}`);
        else {
          const verdicts = parseGroundingVerdicts(judged.value);
          if (!verdicts.ok) diagnostics.push(`Grounding parse failure (advisory); retaining untrusted drafts: ${verdicts.errors.join('; ')}`);
          else {
            diagnostics.push(...verdicts.errors);
            const applied = applyGroundingVerdicts(kept, verdicts.value);
            kept = [...applied.kept];
            rejected.push(...applied.rejected);
            diagnostics.push(...applied.diagnostics);
          }
        }
      }
      const coverageExcerpts = request.chunks.map(chunk => ({ id: chunk.id, text: chunk.text,
        ...(chunk.locator.kind === 'timecode' ? { startSec: chunk.locator.startSec, endSec: chunk.locator.endSec } : {}) }));
      const coverage = computeCoverage(kept, coverageExcerpts);
      const output = buildDistillationOutput({ extractionIntent: this.intent,
        sourceType: proposal.sourceType, sourcePurpose: proposal.sourcePurpose, sourceCoherence: proposal.sourceCoherence,
        theses: proposal.theses, units: kept, rejectedUnits: rejected,
        coverage: { ...coverage, weakQuoteCount: coverage.weakQuoteCount + verified.weakQuoteCount },
        diagnostics, model, promptVersion: DISTILL_PROMPT_VERSION });
      return { ok: true, value: { ...output, tokenUsage: totalTokens, distillation: { ...output.distillation, failedClosed: false } } };
    } catch (error) {
      return failClosed(error instanceof Error ? error.message : String(error));
    }
  }
}
