import { describe, expect, it } from 'vitest';
import { SourceDistillationMiner } from '../../../src/extract/index.js';
import { RecordingLlm, grounded, payload, request, source, unit } from './fixture.js';

describe('SourceDistillationMiner', () => {
  it('generates and semantically reviews an evidence-linked untrusted draft', async () => {
    const llm = new RecordingLlm([payload(), grounded]);
    const result = await new SourceDistillationMiner().mine(request(llm));
    expect(result.ok).toBe(true);
    if (!result.ok) throw result.error;
    expect(result.value.claims).toHaveLength(1);
    expect(result.value.claims[0]?.metadata).toMatchObject({ method: 'llm-distill', trusted: false, unitId: 'u1' });
    expect(result.value.claims[0]?.excerptIds).toEqual(['ex1']);
    expect(result.value.tokenUsage).toBe(300);
    expect(llm.requests).toHaveLength(2);
  });
});

it('repairs invalid generation only once and counts all completed calls', async () => {
  const llm = new RecordingLlm(['invalid', payload(), grounded]);
  const result = await new SourceDistillationMiner().mine(request(llm));
  expect(result.ok && result.value.claims).toHaveLength(1);
  expect(result.ok && result.value.tokenUsage).toBe(450);
  expect(llm.requests[1]?.user).toMatch(/failed validation/u);
  expect(llm.requests).toHaveLength(3);
});

it('fails closed after the one schema repair also fails', async () => {
  const llm = new RecordingLlm(['invalid', 'invalid again']);
  const result = await new SourceDistillationMiner().mine(request(llm));
  expect(result.ok && result.value).toMatchObject({ claims: [], tokenUsage: 300, distillation: { failedClosed: true } });
  expect(llm.requests).toHaveLength(2);
});

it.each([
  { ok: false as const, error: new Error('synthetic transport failure'), usage: { inputTokens: 60, outputTokens: 40, totalTokens: 100 } },
  'not a verdict object',
  JSON.stringify({ verdicts: [] }),
])('retains only untrusted drafts when ordinary grounding is unavailable: %s', async reply => {
  const llm = new RecordingLlm([payload(), reply]);
  const result = await new SourceDistillationMiner().mine(request(llm));
  expect(result.ok && result.value.claims).toHaveLength(1);
  expect(result.ok && result.value.claims[0]?.metadata?.['trusted']).toBe(false);
  expect(result.ok && result.value.distillation?.diagnostics.join(' ')).toMatch(/grounding|no grounding verdict/iu);
});

it('preserves earlier reported usage if a later provider call throws', async () => {
  const llm = new RecordingLlm([payload(), new Error('synthetic interrupted grounding')]);
  const result = await new SourceDistillationMiner().mine(request(llm));
  expect(result.ok && result.value.tokenUsage).toBe(150);
  expect(result.ok && result.value.distillation?.diagnostics.join(' ')).toMatch(/reported tokens only/u);
  expect(result.ok && result.value.claims[0]?.metadata?.['trusted']).toBe(false);
});

it('archives an explicitly ungrounded unit instead of exporting it as a claim', async () => {
  const llm = new RecordingLlm([payload(), JSON.stringify({ verdicts: [{ unitId: 'u1', verdict: 'ungrounded' }] })]);
  const result = await new SourceDistillationMiner().mine(request(llm));
  expect(result.ok && result.value.claims).toEqual([]);
  expect(result.ok && result.value.rejectedClaims).toMatchObject([{ metadata: { unitId: 'u1', rejectionReason: 'ungrounded', trusted: false } }]);
});

it.each([{ ids: [] }, { ids: ['', 'ex1'] }, { ids: ['ex1', 'ex1'] }])('rejects unusable excerpt identities before any model call: %s', async ({ ids }) => {
  const llm = new RecordingLlm([]);
  const input = request(llm);
  const chunks = ids.map(id => ({ id, text: source, segments: [], locator: { kind: 'text' as const, charStart: 0, charEnd: source.length } }));
  const result = await new SourceDistillationMiner().mine({ ...input, chunks });
  expect(result.ok).toBe(false);
  expect(llm.requests).toEqual([]);
});

it.each([0, 10_000])('blocks another call when the reported token ceiling is reached: %s', async maxTokens => {
  const llm = new RecordingLlm([{ ok: true, value: payload(), usage: { inputTokens: 9500, outputTokens: 500, totalTokens: 10_000 } }, grounded]);
  const result = await new SourceDistillationMiner().mine({ ...request(llm), costCeiling: { maxTokens } });
  expect(result.ok && result.value.distillation?.failedClosed).toBe(true);
  expect(llm.requests).toHaveLength(maxTokens === 0 ? 0 : 1);
  if (maxTokens) {
    expect(llm.requests[0]?.maxTokens).toBeGreaterThan(0);
    expect(llm.requests[0]?.maxTokens).toBeLessThan(10_000);
  }
});

it('blocks a priced ceiling before calling a usage-only provider', async () => {
  const llm = new RecordingLlm([]);
  const result = await new SourceDistillationMiner().mine({ ...request(llm), costCeiling: { maxSpendUsd: 1 } });
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.error.message).toMatch(/dollar ceilings/u);
  expect(llm.requests).toEqual([]);
});

it('does not continue a token-limited run when provider usage is missing', async () => {
  const llm = new RecordingLlm([{ ok: true, value: payload() }]);
  const result = await new SourceDistillationMiner().mine({ ...request(llm), costCeiling: { maxTokens: 10_000 } });
  expect(result.ok && result.value).toMatchObject({ claims: [], distillation: { failedClosed: true } });
  expect(llm.requests).toHaveLength(1);
});

it('uses the same evidence contract for timecoded sources', async () => {
  const llm = new RecordingLlm([payload(), grounded]);
  const input = request(llm);
  const result = await new SourceDistillationMiner().mine({ ...input, chunks: input.chunks.map(chunk => ({
    ...chunk, locator: { kind: 'timecode', startSec: 0, endSec: 60 },
  })) });
  expect(result.ok && result.value.distillation?.coverage).toMatchObject({ citedExcerptCount: 1, largestUncitedGapSeconds: 0 });
});

it.each([
  ['the updated device now can', "the updated device now can't operate safely under load"],
  ['the final batch contained 15.', 'the final batch contained 15.5 samples'],
  ['the final batch contained 𐐀', 'the final batch contained 𐐀𐐁 samples'],
])('excludes a false literal span before grounding: %s', async (quote, fragment) => {
  const llm = new RecordingLlm([payload([unit, { ...unit, id: 'u2', evidence: [{ excerptId: 'ex1', quote }] }]), grounded]);
  const input = request(llm);
  const text = `${source} The synthetic report records that ${fragment} and provides several independent observations afterwards.`;
  const result = await new SourceDistillationMiner({ quoteFailureCloseThreshold: 1 }).mine({ ...input,
    chunks: [{ id: 'ex1', segments: [], text, locator: { kind: 'text', charStart: 0, charEnd: text.length } }] });
  expect(result.ok && result.value.claims).toHaveLength(1);
  expect(result.ok && result.value.rejectedClaims).toMatchObject([{ metadata: { unitId: 'u2', rejectionReason: 'failed_quote_verification' } }]);
  expect(llm.requests[1]?.user).not.toContain('"unitId": "u2"');
});

it('refuses a prompt larger than the configured token allowance before any call', async () => {
  const llm = new RecordingLlm([payload(), grounded]);
  const input = request(llm);
  const text = 'A detailed original source with additional observations. '.repeat(1000);
  const result = await new SourceDistillationMiner().mine({ ...input, costCeiling: { maxTokens: 500 },
    chunks: [{ id: 'ex1', text, segments: [], locator: { kind: 'text', charStart: 0, charEnd: text.length } }] });
  expect(result.ok && result.value.distillation?.failedClosed).toBe(true);
  expect(llm.requests).toEqual([]);
});

it('applies valid rejections even when another grounding verdict is malformed', async () => {
  const llm = new RecordingLlm([payload([unit, { ...unit, id: 'u2' }]), JSON.stringify({ verdicts: [
    { unitId: 'u1', verdict: 'ungrounded' },
    { unitId: 'u2', verdict: 'rewrite', text: 'short' },
  ] })]);
  const result = await new SourceDistillationMiner().mine(request(llm));
  expect(result.ok && result.value.claims).toHaveLength(1);
  expect(result.ok && result.value.claims[0]?.metadata?.['unitId']).toBe('u2');
  expect(result.ok && result.value.rejectedClaims).toMatchObject([{ metadata: { unitId: 'u1', rejectionReason: 'ungrounded' } }]);
  expect(result.ok && result.value.distillation?.diagnostics.join(' ')).toMatch(/verdicts.1.text/u);
});

it.each([new Error('synthetic interrupted review'), { ok: true as const, value: grounded }])('retains advisory grounding output when final usage is unavailable in a token-limited run: %s', async reply => {
  const llm = new RecordingLlm([payload(), reply]);
  const result = await new SourceDistillationMiner().mine({ ...request(llm), costCeiling: { maxTokens: 10_000 } });
  expect(result.ok && result.value.claims).toHaveLength(1);
  expect(result.ok && result.value.tokenUsage).toBe(150);
  expect(result.ok && result.value.claims[0]?.metadata?.['trusted']).toBe(false);
  expect(result.ok && result.value.distillation?.diagnostics.join(' ')).toMatch(/reported tokens only/u);
  expect(llm.requests).toHaveLength(2);
});
