// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 Colin Farmer (GitCmurf)

import { describe, expect, it } from 'vitest';
import { SourceDistillationMiner } from '../../../src/extract/distill/miner.js';
import { DISTILLATION_SCHEMA_VERSION } from '../../../src/extract/distill/schema.js';
import type { LlmClient, LlmCompletionResult } from '../../../src/extract/llm-client.js';
import type { Chunk, MiningRequest } from '../../../src/interfaces/index.js';

class FakeLlmClient implements LlmClient {
  public requests: Array<{ system: string; user: string }> = [];
  constructor(private responses: string[]) {}
  async generate(request: { system: string; user: string }): Promise<LlmCompletionResult> {
    this.requests.push({ system: request.system, user: request.user });
    const next = this.responses.shift();
    if (next === undefined) return { ok: false, error: new Error('FakeLlmClient exhausted') };
    return { ok: true, value: next, usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 } };
  }
}

const EX1_TEXT = 'The agent reads index files and follows explicit links instead of using embedding similarity over chunks.';
const EX2_TEXT = 'For very large enterprise corpora the markdown approach scales poorly compared with traditional RAG systems.';

function chunk(id: string, text: string, startSec: number): Chunk {
  return {
    id,
    text,
    segments: [],
    locator: { kind: 'timecode', startSec, endSec: startSec + 60 },
  };
}

function miningRequest(llm: LlmClient): MiningRequest {
  return {
    raw: { canonicalId: 'res-1', sourceType: 'youtube', sensitivity: 'public', label: 'Test Video', payload: {} },
    chunks: [chunk('ex1', EX1_TEXT, 0), chunk('ex2', EX2_TEXT, 60)],
    context: {},
    config: { llm: { model: 'gpt-5.4-mini' }, extraction: {} },
    policyRoute: 'cloud',
    llm,
    costCeiling: {},
  } as unknown as MiningRequest;
}

function distillResponse(units: unknown[]): string {
  return JSON.stringify({
    schemaVersion: DISTILLATION_SCHEMA_VERSION,
    sourceType: 'explainer',
    sourceCoherence: 'single_topic',
    theses: ['Markdown wikis with explicit links are a viable retrieval alternative for small corpora.'],
    units,
  });
}

const goodUnit = {
  id: 'u1',
  kind: 'idea',
  text: 'A markdown wiki can answer questions by reading index files and following explicit links.',
  stance: 'asserted',
  evidence: [{ excerptId: 'ex1', quote: 'reads index files and follows explicit links' }],
  importance: 'core',
};

const groundedVerdicts = JSON.stringify({ verdicts: [{ unitId: 'u1', verdict: 'grounded' }] });
const noRelations = JSON.stringify({ relations: [] });

describe('SourceDistillationMiner', () => {
  it('runs distill -> grounding -> consolidation and emits claims', async () => {
    const llm = new FakeLlmClient([distillResponse([goodUnit]), groundedVerdicts, noRelations]);
    const miner = new SourceDistillationMiner({ extractionIntent: 'knowledge_graph' });
    const result = await miner.mine(miningRequest(llm));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.claims).toHaveLength(1);
      expect(result.value.claims[0]?.metadata?.['method']).toBe('llm-distill');
      expect(result.value.distillation?.coverage?.citedExcerptCount).toBe(1);
      // single unit => consolidation pass is skipped, so only 2 LLM calls
      expect(llm.requests).toHaveLength(2);
    }
  });

  it('retries once with a repair prompt on schema failure, then succeeds', async () => {
    const llm = new FakeLlmClient(['{"not":"a distillation"}', distillResponse([goodUnit]), groundedVerdicts]);
    const miner = new SourceDistillationMiner({ extractionIntent: 'knowledge_graph' });
    const result = await miner.mine(miningRequest(llm));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.claims).toHaveLength(1);
    expect(llm.requests[1]?.user).toMatch(/failed validation/i);
  });

  it('fails closed when the repair retry also fails to parse', async () => {
    const llm = new FakeLlmClient(['nope', 'still nope']);
    const miner = new SourceDistillationMiner({ extractionIntent: 'knowledge_graph' });
    const result = await miner.mine(miningRequest(llm));
    expect(result.ok).toBe(true); // fail-closed is a successful mining run with zero claims
    if (result.ok) {
      expect(result.value.claims).toHaveLength(0);
      expect(result.value.distillation?.failedClosed).toBe(true);
    }
  });

  it('fails closed when quote verification failure ratio exceeds the threshold', async () => {
    const fabricated = {
      ...goodUnit,
      id: 'u2',
      text: 'A fabricated unit whose quote does not appear anywhere in the transcript at all.',
      evidence: [{ excerptId: 'ex1', quote: 'quantum blockchain synergies maximize stakeholder paradigms' }],
    };
    // 1 of 2 units failed = 0.5 > 0.3 threshold
    const llm = new FakeLlmClient([distillResponse([goodUnit, fabricated])]);
    const miner = new SourceDistillationMiner({ extractionIntent: 'knowledge_graph' });
    const result = await miner.mine(miningRequest(llm));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.claims).toHaveLength(0);
      expect(result.value.distillation?.failedClosed).toBe(true);
      expect(result.value.distillation?.diagnostics.join(' ')).toMatch(/quote verification/i);
    }
  });

  it('demotes below-threshold failed units to rejected and proceeds', async () => {
    const fabricated = {
      ...goodUnit,
      id: 'u4',
      text: 'A fabricated unit whose quote does not appear anywhere in the transcript at all.',
      evidence: [{ excerptId: 'ex1', quote: 'quantum blockchain synergies maximize stakeholder paradigms' }],
    };
    const moreGood = ['u2', 'u3'].map(id => ({
      ...goodUnit,
      id,
      text: `Unit ${id}: enterprise corpora scale poorly with markdown crawling versus traditional RAG.`,
      evidence: [{ excerptId: 'ex2', quote: 'scales poorly compared with traditional RAG systems' }],
    }));
    // 1 of 4 failed = 0.25 <= 0.3
    const verdicts = JSON.stringify({ verdicts: [
      { unitId: 'u1', verdict: 'grounded' },
      { unitId: 'u2', verdict: 'grounded' },
      { unitId: 'u3', verdict: 'grounded' },
    ] });
    const llm = new FakeLlmClient([distillResponse([goodUnit, ...moreGood, fabricated]), verdicts, noRelations]);
    const miner = new SourceDistillationMiner({ extractionIntent: 'knowledge_graph' });
    const result = await miner.mine(miningRequest(llm));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.claims).toHaveLength(3);
      expect(result.value.rejectedClaims?.some(claim => claim.metadata?.['rejectionReason'] === 'failed_quote_verification')).toBe(true);
    }
  });

  it('aggregates token usage across passes', async () => {
    const llm = new FakeLlmClient([distillResponse([goodUnit]), groundedVerdicts]);
    const miner = new SourceDistillationMiner({ extractionIntent: 'knowledge_graph' });
    const result = await miner.mine(miningRequest(llm));
    if (result.ok) expect(result.value.tokenUsage).toBe(300); // 2 passes x 150 (single unit skips consolidation)
  });
});
