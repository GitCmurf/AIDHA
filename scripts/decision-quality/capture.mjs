// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import { buildCategoryRequest } from './category.mjs';
import { buildGroundingRequest } from './grounding.mjs';
import { fingerprint, stampReceipt, scoreDecisions } from './quality.mjs';
import { nativePayload } from './plan.mjs';
import { parseOpenAIReply, OPENAI_ENDPOINT } from './openai.mjs';
import { parseOpenRouterReply, OPENROUTER_ENDPOINT } from './openrouter.mjs';

/** Offline conversion only. The caller must already have saved the original capture file. */
export function normalizeNativeCaptures(corpus, provider, model, captures) {
  assert.ok(['openai', 'openrouter'].includes(provider), 'Unknown provider');
  assert.ok(['categorization', 'grounding'].includes(corpus.task), 'Unknown task');
  assert.ok(Array.isArray(captures), 'Captures must be an array');
  const build = corpus.task === 'categorization' ? c => buildCategoryRequest(c, corpus.taxonomy) : buildGroundingRequest;
  const parser = provider === 'openai' ? parseOpenAIReply : parseOpenRouterReply;
  const endpoint = provider === 'openai' ? OPENAI_ENDPOINT : OPENROUTER_ENDPOINT;
  const cases = new Map(corpus.cases.map(c => [c.id, c]));
  const receipts = captures.map(capture => {
    const testCase = cases.get(capture.caseId);
    assert.ok(testCase, `Unknown case ${capture.caseId}`);
    assert.ok(['synthetic', 'recorded-provider'].includes(capture.evidenceKind), 'Declare capture evidenceKind explicitly');
    const request = build(testCase);
    const payload = nativePayload(provider, request, model);
    assert.equal(capture.corpusHash, fingerprint(corpus), 'Capture corpus hash mismatch');
    assert.equal(capture.requestHash, fingerprint(request), 'Capture request hash mismatch');
    assert.equal(capture.nativePayloadHash, fingerprint(payload), 'Capture native payload hash mismatch');
    assert.ok(Object.hasOwn(capture, 'rawReply'), 'Capture needs a raw reply, including explicit null on failure');
    assert.ok(capture.durationMs === null ||
      (typeof capture.durationMs === 'number' && Number.isFinite(capture.durationMs) && capture.durationMs >= 0),
    'Capture duration must be nonnegative or explicit null');
    let parsed = capture.rawReply;
    if (typeof parsed === 'string') {
      try { parsed = JSON.parse(parsed); } catch { parsed = null; }
    }
    const result = parser(parsed, request);
    // Never assign a requested alias to a reply that does not identify its actual model.
    // Preserve that failure in the source captures; no partial-batch score is produced.
    assert.ok(result.resolvedModel, `Cannot score case ${capture.caseId}: no reported model identity; retain original capture`);
    return stampReceipt(corpus, testCase, request, {
      requestedModel: model, resolvedModel: result.resolvedModel, endpoint,
      evidenceKind: capture.evidenceKind, status: result.status, answers: result.answers,
      rawReply: capture.rawReply, usage: result.usage, costUsd: result.costUsd, durationMs: capture.durationMs,
      nativePayloadHash: capture.nativePayloadHash, ...(result.error ? { error: result.error } : {}),
    });
  });
  // Require a complete single-identity batch; never silently discard failed/duplicate cases.
  scoreDecisions(corpus, build, receipts);
  return receipts;
}
