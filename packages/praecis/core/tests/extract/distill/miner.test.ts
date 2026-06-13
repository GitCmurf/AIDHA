// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 Colin Farmer (GitCmurf)

import { describe, expect, it } from 'vitest';
import { SourceDistillationMiner } from '../../../src/extract/distill/miner.js';
import type { LlmClient } from '../../../src/extract/llm-client.js';
import type { Chunk, MiningRequest } from '../../../src/interfaces/index.js';
import { FakeLlmClient, chunk, miningRequest, distillResponse } from './fake-llm.js';

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

  // C1: mine() must never reject — honor the Result contract
  it('returns an error result for empty chunks instead of throwing', async () => {
    const llm = new FakeLlmClient([]);
    const miner = new SourceDistillationMiner({ extractionIntent: 'knowledge_graph' });
    const request = miningRequest(llm);
    (request as { chunks: Chunk[] }).chunks = [];
    const result = await miner.mine(request);
    expect(result.ok).toBe(false);
  });

  it('fails closed when the LLM client throws instead of returning a Result', async () => {
    const throwingLlm: LlmClient = {
      async generate() { throw new Error('socket hang up'); },
    };
    const miner = new SourceDistillationMiner({ extractionIntent: 'knowledge_graph' });
    const result = await miner.mine(miningRequest(throwingLlm));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.claims).toHaveLength(0);
      expect(result.value.distillation?.failedClosed).toBe(true);
      expect(result.value.distillation?.diagnostics.join(' ')).toMatch(/socket hang up/);
    }
  });

  // I1: cost ceiling enforcement
  it('fails closed when the cost ceiling is exhausted mid-run', async () => {
    const llm = new FakeLlmClient([distillResponse([goodUnit]), groundedVerdicts]);
    const miner = new SourceDistillationMiner({ extractionIntent: 'knowledge_graph' });
    const request = { ...miningRequest(llm), costCeiling: { maxTokens: 100 } } as unknown as MiningRequest;
    const result = await miner.mine(request);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.distillation?.failedClosed).toBe(true);
      expect(result.value.distillation?.diagnostics.join(' ')).toMatch(/cost ceiling/i);
    }
  });

  // C2: section notes end-to-end pass
  it('runs the section-notes pass for long sources and threads notes into distillation', async () => {
    // 3 chunks of ~1289 tokens each with sectionNotesSectionTokens: 1500 => 3 sections (one per chunk)
    const longText = (seed: string) => `${seed} unique opening sentence about retrieval systems ${'transcript words '.repeat(300)}`;
    const chunks = [
      chunk('ex1', longText('alpha'), 0),
      chunk('ex2', longText('beta'), 60),
      chunk('ex3', longText('gamma'), 120),
    ];
    const notesResponse = JSON.stringify({ notes: [{ observation: 'alpha idea', snippet: 'transcript words', excerptId: 'ex1' }], entities: ['Alpha'] });
    const unitForLong = {
      ...goodUnit,
      evidence: [{ excerptId: 'ex1', quote: 'alpha unique opening sentence about retrieval systems' }],
      text: 'Alpha-related canonical idea that is long enough to satisfy the schema.',
    };
    // miner with sectionNotesTokenThreshold tiny and sectionTokens sized to produce 3 sections (one per chunk)
    const longMiner = new SourceDistillationMiner({
      extractionIntent: 'knowledge_graph',
      sectionNotesTokenThreshold: 500,
      sectionNotesSectionTokens: 1500,
    });
    // queue: 3 section-notes responses + distill + grounding (single unit skips consolidation)
    const llm = new FakeLlmClient([notesResponse, notesResponse, notesResponse, distillResponse([unitForLong]), groundedVerdicts]);
    const request = { ...miningRequest(llm), chunks } as unknown as MiningRequest;
    const result = await longMiner.mine(request);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.distillation?.failedClosed).toBe(false);
      expect(result.value.distillation?.diagnostics.join(' ')).toMatch(/section-notes path active/i);
    }
    // the distill call (after the section calls) must carry SECTION_NOTES
    const distillCall = llm.requests.find(r => r.user.includes('SECTION_NOTES'));
    expect(distillCall).toBeDefined();
    // 3 sections + distill + grounding = 5 total
    expect(llm.requests.length).toBe(5);
  });

  // I2: estimate() accounts for Pass 0
  it('estimate returns a higher token estimate for sources exceeding the section-notes threshold', () => {
    // Use a very low threshold so a small fixture triggers it
    const miner = new SourceDistillationMiner({ extractionIntent: 'knowledge_graph', sectionNotesTokenThreshold: 10 });
    const shortRequest = miningRequest(new FakeLlmClient([]));
    const longRequest = {
      ...shortRequest,
      chunks: [
        chunk('ex1', 'The agent reads index files and follows explicit links instead of using embedding similarity over chunks.', 0),
        chunk('ex2', 'For very large enterprise corpora the markdown approach scales poorly compared with traditional RAG systems.', 60),
      ],
    } as unknown as MiningRequest;
    const shortMiner = new SourceDistillationMiner({ extractionIntent: 'knowledge_graph' });
    const shortEstimate = shortMiner.estimate(shortRequest);
    const longEstimate = miner.estimate(longRequest);
    expect(shortEstimate.ok).toBe(true);
    expect(longEstimate.ok).toBe(true);
    if (shortEstimate.ok && longEstimate.ok) {
      expect(longEstimate.value.tokenUsage).toBeGreaterThan(shortEstimate.value.tokenUsage);
    }
  });
});
