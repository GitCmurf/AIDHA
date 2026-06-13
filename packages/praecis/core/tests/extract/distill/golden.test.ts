// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 Colin Farmer (GitCmurf)
//
// AIDHA-TASK-012 — Golden recall / behavior fixtures for SourceDistillationMiner.
// Each test exercises one failure class from plan-010 via a scripted FakeLlmClient
// and asserts PIPELINE BEHAVIOR rather than exact wording.
//
// IMPORTANT — quote rules (from quote-verification.ts):
//   • ≥5 tokens, ≥4 unique tokens, ≤50% of excerpt token count
//   • Must be a verbatim/normalized/fuzzy substring of the cited chunk's text.
// All chunks are chosen to be comfortably long so every quote satisfies all rules.

import { describe, expect, it } from 'vitest';
import { SourceDistillationMiner } from '../../../src/extract/distill/miner.js';
import type { MiningRequest } from '../../../src/interfaces/index.js';
import { FakeLlmClient, chunk, miningRequest, distillResponse } from './fake-llm.js';

// ── shared chunk texts long enough to satisfy the ≤50% ratio rule ───────────

// Each chunk is ~30+ tokens; quotes are 6–10 tokens.
const IDEA_A_TEXT = 'Neural networks learn hierarchical representations by stacking multiple layers of nonlinear transformations that progressively abstract raw input signals into task-relevant features used for downstream classification and regression tasks.';
const IDEA_B_TEXT = 'Attention mechanisms allow models to dynamically weight different parts of the input sequence at each decoding step, enabling accurate long-range dependency capture without the vanishing-gradient issues of early recurrent architectures.';
const IDEA_C_TEXT = 'Transformer architectures replaced recurrent networks as the dominant paradigm for sequence modelling because self-attention can be parallelised over the full context window, dramatically reducing training time on modern GPU clusters.';

const MECH_TEXT = 'Backpropagation computes the gradient of the loss with respect to each parameter by recursively applying the chain rule through the computational graph, producing exact gradients that are used by optimisers such as stochastic gradient descent.';
const EX_TEXT = 'Consider a simple two-layer perceptron trained on MNIST digit images: after backpropagation the first layer learns Gabor-like edge detectors while the second learns digit-part templates, demonstrating hierarchical feature reuse in shallow networks.';

const PROC_TEXT = 'To fine-tune a pre-trained language model on a downstream classification task: first freeze the base encoder weights, then add a linear classification head, train the head for one epoch, unfreeze the final two encoder layers, and finally anneal the learning rate over three additional epochs.';

const MIXED_TEXT = 'This video covers several unrelated topics including quantum key distribution, medieval manuscript illumination techniques, and strategies for optimising database index structures, with no single unifying thesis across the segments.';

const ATTRIB_TEXT = 'Andrej Karpathy has argued in multiple lectures and blog posts that the transformer architecture is surprisingly simple to implement from scratch, requiring fewer than three hundred lines of clean Python once the attention kernel is properly understood.';

const REC_TEXT = 'Teams adopting large language models for production search should always implement retrieval-augmented generation rather than relying on parametric memory alone, because parametric knowledge becomes stale immediately after the training cutoff and hallucination rates rise sharply on time-sensitive queries.';
const LIM_TEXT = 'Retrieval-augmented generation systems degrade significantly when the retrieval corpus is poorly indexed or when query-document lexical overlap is low, which is a fundamental limitation that affects performance on specialised technical domains requiring dense vector similarity.';

const WEAK_REC_TEXT = 'Practitioners should adopt gradient clipping when training deep recurrent networks to prevent the exploding-gradient pathology, which otherwise causes parameter updates to become numerically unbounded and renders the model untrainable regardless of learning-rate schedule.';

// ── Fixture 1: Three core ideas, all extracted (recall guard) ────────────────

describe('golden fixtures', () => {
  it('F1 – three core ideas all reach claims (recall guard)', async () => {
    const chunks = [
      chunk('ex1', IDEA_A_TEXT, 0),
      chunk('ex2', IDEA_B_TEXT, 60),
      chunk('ex3', IDEA_C_TEXT, 120),
    ];

    const units = [
      {
        id: 'u1',
        kind: 'idea',
        text: 'Neural networks learn hierarchical feature representations through stacked nonlinear transformations.',
        stance: 'asserted',
        importance: 'core',
        evidence: [{ excerptId: 'ex1', quote: 'learn hierarchical representations by stacking multiple layers of nonlinear transformations' }],
      },
      {
        id: 'u2',
        kind: 'idea',
        text: 'Attention mechanisms capture long-range dependencies without the vanishing-gradient problem.',
        stance: 'asserted',
        importance: 'core',
        evidence: [{ excerptId: 'ex2', quote: 'dynamically weight different parts of the input sequence at each decoding step' }],
      },
      {
        id: 'u3',
        kind: 'idea',
        text: 'Transformer architectures dominate sequence modelling due to parallelisable self-attention.',
        stance: 'asserted',
        importance: 'core',
        evidence: [{ excerptId: 'ex3', quote: 'self-attention can be parallelised over the full context window' }],
      },
    ];

    const groundedVerdicts = JSON.stringify({
      verdicts: [
        { unitId: 'u1', verdict: 'grounded' },
        { unitId: 'u2', verdict: 'grounded' },
        { unitId: 'u3', verdict: 'grounded' },
      ],
    });
    const noRelations = JSON.stringify({ relations: [] });

    const llm = new FakeLlmClient([
      distillResponse(units),    // Pass 1 distill
      groundedVerdicts,          // Pass 2a grounding
      noRelations,               // Pass 2b consolidation (3 units → runs)
    ]);
    const miner = new SourceDistillationMiner({ extractionIntent: 'knowledge_graph' });
    const result = await miner.mine(miningRequest(llm, chunks));

    expect(result.ok).toBe(true);
    if (result.ok) {
      // All 3 ideas must become claims — guards against under-extraction
      expect(result.value.claims).toHaveLength(3);
      expect(result.value.distillation?.failedClosed).toBe(false);
    }
    // 3 units → distill + grounding + consolidation = 3 calls
    expect(llm.requests).toHaveLength(3);
  });

  // ── Fixture 2: Demo example supports a mechanism ───────────────────────────

  it('F2 – example lands in supportingUnits linked to mechanism claim', async () => {
    const chunks = [
      chunk('ex1', MECH_TEXT, 0),
      chunk('ex2', EX_TEXT, 60),
    ];

    const u1mechanism = {
      id: 'u1',
      kind: 'mechanism',
      text: 'Backpropagation computes parameter gradients by recursively applying the chain rule through the computational graph.',
      stance: 'asserted',
      importance: 'core',
      evidence: [{ excerptId: 'ex1', quote: 'computes the gradient of the loss with respect to each parameter by recursively applying the chain rule' }],
    };
    const u2example = {
      id: 'u2',
      kind: 'example',
      text: 'A two-layer perceptron on MNIST illustrates hierarchical feature reuse learned via backpropagation.',
      stance: 'demonstrated',
      importance: 'supporting',
      supportsUnitIds: ['u1'],
      evidence: [{ excerptId: 'ex2', quote: 'two-layer perceptron trained on MNIST digit images' }],
    };

    const groundedVerdicts = JSON.stringify({
      verdicts: [
        { unitId: 'u1', verdict: 'grounded' },
        { unitId: 'u2', verdict: 'grounded' },
      ],
    });
    const noRelations = JSON.stringify({ relations: [] });

    const llm = new FakeLlmClient([
      distillResponse([u1mechanism, u2example]),  // Pass 1 distill
      groundedVerdicts,                            // Pass 2a grounding
      noRelations,                                 // Pass 2b consolidation (2 units)
    ]);
    const miner = new SourceDistillationMiner({ extractionIntent: 'knowledge_graph' });
    const result = await miner.mine(miningRequest(llm, chunks));

    expect(result.ok).toBe(true);
    if (result.ok) {
      // mechanism is a claim; example is a supportingUnit — NOT a claim
      expect(result.value.claims).toHaveLength(1);
      expect(result.value.claims[0]?.metadata?.['unitKind']).toBe('mechanism');
      expect(result.value.supportingUnits).toHaveLength(1);
      expect(result.value.supportingUnits[0]?.kind).toBe('example');
      expect(result.value.supportingUnits[0]?.supportsUnitIds).toContain('u1');
    }
    // 2 units → distill + grounding + consolidation = 3 calls
    expect(llm.requests).toHaveLength(3);
  });

  // ── Fixture 3: Tutorial procedure — intent decides projection ─────────────

  it('F3 – procedure is supportingUnit for knowledge_graph but claim for runbook', async () => {
    const chunks = [chunk('ex1', PROC_TEXT, 0)];

    const procedureUnit = {
      id: 'u1',
      kind: 'procedure',
      text: 'To fine-tune a pre-trained language model: freeze the base encoder, add a classification head, train one epoch, then unfreeze final layers.',
      stance: 'recommended',
      importance: 'core',
      evidence: [{ excerptId: 'ex1', quote: 'freeze the base encoder weights then add a linear classification head' }],
    };

    const groundedVerdict = JSON.stringify({ verdicts: [{ unitId: 'u1', verdict: 'grounded' }] });

    // knowledge_graph run: procedure → supportingUnit (projection: 'procedure')
    const kgLlm = new FakeLlmClient([
      distillResponse([procedureUnit], { sourceType: 'tutorial' }),  // Pass 1
      groundedVerdict,                                                  // Pass 2a (1 unit → no consolidation)
    ]);
    const kgMiner = new SourceDistillationMiner({ extractionIntent: 'knowledge_graph' });
    const kgResult = await kgMiner.mine(miningRequest(kgLlm, chunks));

    expect(kgResult.ok).toBe(true);
    if (kgResult.ok) {
      expect(kgResult.value.claims).toHaveLength(0);
      expect(kgResult.value.supportingUnits).toHaveLength(1);
      expect(kgResult.value.supportingUnits[0]?.kind).toBe('procedure');
    }
    expect(kgLlm.requests).toHaveLength(2);

    // runbook run: procedure → claim (projection: 'claim')
    const rbLlm = new FakeLlmClient([
      distillResponse([procedureUnit], { sourceType: 'tutorial' }),  // Pass 1
      groundedVerdict,                                                  // Pass 2a (1 unit → no consolidation)
    ]);
    const rbMiner = new SourceDistillationMiner({ extractionIntent: 'runbook' });
    const rbResult = await rbMiner.mine(miningRequest(rbLlm, chunks));

    expect(rbResult.ok).toBe(true);
    if (rbResult.ok) {
      expect(rbResult.value.claims).toHaveLength(1);
      expect(rbResult.value.claims[0]?.metadata?.['unitKind']).toBe('procedure');
      expect(rbResult.value.supportingUnits).toHaveLength(0);
    }
    expect(rbLlm.requests).toHaveLength(2);
  });

  // ── Fixture 4: Mixed-topic source, no forced thesis ───────────────────────

  it('F4 – mixed-topic source with no thesis still succeeds and warns in diagnostics', async () => {
    const chunks = [chunk('ex1', MIXED_TEXT, 0)];

    const unit = {
      id: 'u1',
      kind: 'idea',
      text: 'This video covers unrelated topics without a single unifying argument or thesis across segments.',
      stance: 'asserted',
      importance: 'core',
      evidence: [{ excerptId: 'ex1', quote: 'covers several unrelated topics including quantum key distribution' }],
    };

    const groundedVerdict = JSON.stringify({ verdicts: [{ unitId: 'u1', verdict: 'grounded' }] });

    const llm = new FakeLlmClient([
      distillResponse([unit], { sourceCoherence: 'mixed', theses: [] }),  // Pass 1
      groundedVerdict,                                                        // Pass 2a (1 unit → no consolidation)
    ]);
    const miner = new SourceDistillationMiner({ extractionIntent: 'knowledge_graph' });
    const result = await miner.mine(miningRequest(llm, chunks));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.distillation?.failedClosed).toBe(false);
      expect(result.value.claims.length).toBeGreaterThanOrEqual(1);
      // Diagnostics must warn about missing thesis
      const diag = result.value.distillation?.diagnostics.join(' ') ?? '';
      expect(diag).toMatch(/thesis/i);
    }
    expect(llm.requests).toHaveLength(2);
  });

  // ── Fixture 5: Named third-party attribution preserved ────────────────────

  it('F5 – named third-party attribution and reported stance flow through to claim metadata', async () => {
    const chunks = [chunk('ex1', ATTRIB_TEXT, 0)];

    const unit = {
      id: 'u1',
      kind: 'idea',
      text: 'Karpathy has argued the transformer is surprisingly simple to implement from scratch in under 300 lines of Python.',
      stance: 'reported',
      importance: 'core',
      attribution: { kind: 'named_third_party', name: 'Karpathy' },
      evidence: [{ excerptId: 'ex1', quote: 'transformer architecture is surprisingly simple to implement from scratch' }],
    };

    const groundedVerdict = JSON.stringify({ verdicts: [{ unitId: 'u1', verdict: 'grounded' }] });

    const llm = new FakeLlmClient([
      distillResponse([unit]),  // Pass 1
      groundedVerdict,           // Pass 2a (1 unit → no consolidation)
    ]);
    const miner = new SourceDistillationMiner({ extractionIntent: 'knowledge_graph' });
    const result = await miner.mine(miningRequest(llm, chunks));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.claims).toHaveLength(1);
      const meta = result.value.claims[0]?.metadata;
      expect(meta?.['stance']).toBe('reported');
      expect(meta?.['attribution']).toEqual({ kind: 'named_third_party', name: 'Karpathy' });
    }
    expect(llm.requests).toHaveLength(2);
  });

  // ── Fixture 6: Recommendation + time-bound limitation merge via 'limits' ──

  it('F6 – limitation folded into recommendation conditions via consolidation limits relation', async () => {
    const chunks = [
      chunk('ex1', REC_TEXT, 0),
      chunk('ex2', LIM_TEXT, 60),
    ];

    // recommendation requires rationale (schema enforcement)
    const recUnit = {
      id: 'u1',
      kind: 'recommendation',
      text: 'Production search teams should adopt retrieval-augmented generation over parametric memory to avoid stale knowledge and reduce hallucination on time-sensitive queries.',
      stance: 'recommended',
      importance: 'core',
      rationale: 'Parametric memory becomes stale after training cutoff and hallucination rates rise on time-sensitive queries.',
      evidence: [{ excerptId: 'ex1', quote: 'always implement retrieval-augmented generation rather than relying on parametric memory alone' }],
    };

    // limitation requires rationale or conditions — supply a temporal condition
    const limUnit = {
      id: 'u2',
      kind: 'limitation',
      text: 'Retrieval-augmented generation degrades significantly when the retrieval corpus is poorly indexed or query-document overlap is low.',
      stance: 'asserted',
      importance: 'supporting',
      conditions: [{ type: 'temporal', text: 'This limitation is most acute for systems deployed before dense-vector re-indexing is complete.' }],
      evidence: [{ excerptId: 'ex2', quote: 'degrade significantly when the retrieval corpus is poorly indexed' }],
    };

    const groundedVerdicts = JSON.stringify({
      verdicts: [
        { unitId: 'u1', verdict: 'grounded' },
        { unitId: 'u2', verdict: 'grounded' },
      ],
    });

    // consolidation: u2 limits u1 → fold u2.text into u1.conditions
    const limitsRelation = JSON.stringify({
      relations: [{ type: 'limits', sourceUnitId: 'u2', targetUnitId: 'u1' }],
    });

    const llm = new FakeLlmClient([
      distillResponse([recUnit, limUnit]),  // Pass 1
      groundedVerdicts,                      // Pass 2a
      limitsRelation,                        // Pass 2b (2 units → consolidation runs)
    ]);
    const miner = new SourceDistillationMiner({ extractionIntent: 'knowledge_graph' });
    const result = await miner.mine(miningRequest(llm, chunks));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.distillation?.failedClosed).toBe(false);
      // recommendation lands in claims; the folded condition must appear there
      const recClaim = result.value.claims.find(c => c.metadata?.['unitId'] === 'u1');
      expect(recClaim).toBeDefined();
      const conditions: Array<{ type: string; text: string }> = (recClaim?.metadata?.['conditions'] as Array<{ type: string; text: string }>) ?? [];
      // consolidation.ts:212 folds { type: u2.conditions[0].type, text: u2.text } into u1.conditions
      expect(conditions.some(c => c.text === limUnit.text)).toBe(true);
    }
    // distill + grounding + consolidation = 3 calls
    expect(llm.requests).toHaveLength(3);
  });

  // ── Fixture 7: Grounding rewrite recovers rationale ───────────────────────

  it('F7 – grounding rewrite verdict replaces rationale on a recommendation unit', async () => {
    const chunks = [chunk('ex1', WEAK_REC_TEXT, 0)];

    const ORIGINAL_RATIONALE = 'Gradient clipping prevents unstable training in deep recurrent networks.';
    const RECOVERED_RATIONALE = 'Without gradient clipping, parameter update magnitudes become numerically unbounded, making the model untrainable regardless of learning-rate schedule.';
    const REWRITE_TEXT = 'Practitioners should apply gradient clipping when training deep recurrent networks to prevent the exploding-gradient pathology from rendering the model untrainable.';

    const recUnit = {
      id: 'u1',
      kind: 'recommendation',
      text: 'Practitioners should adopt gradient clipping when training deep recurrent networks to prevent exploding gradients and maintain training stability.',
      stance: 'recommended',
      importance: 'core',
      rationale: ORIGINAL_RATIONALE,
      evidence: [{ excerptId: 'ex1', quote: 'adopt gradient clipping when training deep recurrent networks to prevent the exploding-gradient pathology' }],
    };

    // Grounding returns a rewrite with BOTH text (≥20 chars, required by schema) AND a recovered rationale
    const rewriteVerdict = JSON.stringify({
      verdicts: [{
        unitId: 'u1',
        verdict: 'rewrite',
        text: REWRITE_TEXT,
        rationale: RECOVERED_RATIONALE,
      }],
    });

    const llm = new FakeLlmClient([
      distillResponse([recUnit]),  // Pass 1
      rewriteVerdict,               // Pass 2a (1 unit → no consolidation)
    ]);
    const miner = new SourceDistillationMiner({ extractionIntent: 'knowledge_graph' });
    const result = await miner.mine(miningRequest(llm, chunks));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.claims).toHaveLength(1);
      const meta = result.value.claims[0]?.metadata;
      // The recovered rationale from the rewrite verdict must replace the original
      expect(meta?.['rationale']).toBe(RECOVERED_RATIONALE);
      // The rewritten text must also have replaced the original
      expect(result.value.claims[0]?.text).toBe(REWRITE_TEXT);
    }
    expect(llm.requests).toHaveLength(2);
  });

  // ── Fixture 8: Citation spam — fail-closed when fabricated quotes dominate ─

  it('F8 – fabricated quotes above threshold cause fail-closed with quote verification diagnostic', async () => {
    // 2 good units + 2 fabricated = 2/4 = 0.5 > 0.3 threshold → fail closed
    // (fail-closed fires before grounding, so only 1 LLM call is made)
    const chunks = [
      chunk('ex1', IDEA_A_TEXT, 0),
      chunk('ex2', IDEA_B_TEXT, 60),
    ];

    const realUnit1 = {
      id: 'u1',
      kind: 'idea',
      text: 'Neural networks learn hierarchical feature representations through stacked nonlinear transformations.',
      stance: 'asserted',
      importance: 'core',
      evidence: [{ excerptId: 'ex1', quote: 'learn hierarchical representations by stacking multiple layers of nonlinear transformations' }],
    };
    const realUnit2 = {
      id: 'u2',
      kind: 'idea',
      text: 'Attention mechanisms dynamically weight input at each decoding step to capture long-range dependencies.',
      stance: 'asserted',
      importance: 'core',
      evidence: [{ excerptId: 'ex2', quote: 'dynamically weight different parts of the input sequence at each decoding step' }],
    };

    // Fabricated — quotes do NOT appear in the cited chunks
    const fabricated1 = {
      id: 'u3',
      kind: 'idea',
      text: 'Quantum blockchain synergies maximise stakeholder value through AI-driven paradigm disruption.',
      stance: 'asserted',
      importance: 'core',
      evidence: [{ excerptId: 'ex1', quote: 'quantum blockchain synergies maximise stakeholder value paradigm' }],
    };
    const fabricated2 = {
      id: 'u4',
      kind: 'idea',
      text: 'Decentralised ledger protocols leverage distributed consensus algorithms for immutable knowledge graphs.',
      stance: 'asserted',
      importance: 'core',
      evidence: [{ excerptId: 'ex2', quote: 'decentralised ledger protocols leverage distributed consensus algorithms' }],
    };

    const llm = new FakeLlmClient([
      distillResponse([realUnit1, realUnit2, fabricated1, fabricated2]),  // Pass 1 only
      // No further calls — fail-closed fires at quote-verification stage
    ]);
    const miner = new SourceDistillationMiner({ extractionIntent: 'knowledge_graph' });
    const result = await miner.mine(miningRequest(llm, chunks));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.distillation?.failedClosed).toBe(true);
      expect(result.value.claims).toHaveLength(0);
      const diag = result.value.distillation?.diagnostics.join(' ') ?? '';
      expect(diag).toMatch(/quote verification/i);
    }
    // Fail-closed at miner.ts:264 before grounding → only 1 LLM call (the distill pass)
    expect(llm.requests).toHaveLength(1);
  });
});
