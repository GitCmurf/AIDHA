// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import { prepareRequests } from './run.mjs';
import { fingerprint } from './quality.mjs';
import { buildOpenAIPayload, OPENAI_ENDPOINT } from './openai.mjs';
import { buildOpenRouterPayload, OPENROUTER_ENDPOINT } from './openrouter.mjs';

export const DECISION_MODELS = [
  { provider: 'openrouter', model: 'typesafe/jev-1.14', endpoint: OPENROUTER_ENDPOINT,
    inputUsdPerMillion: 0.042, outputUsdPerMillion: 0,
    reference: 'https://openrouter.ai/typesafe/jev-1.14' },
  { provider: 'openrouter', model: 'microsoft/microsoft-decision-1', endpoint: OPENROUTER_ENDPOINT,
    inputUsdPerMillion: 0.042, outputUsdPerMillion: 0,
    reference: 'https://openrouter.ai/microsoft/microsoft-decision-1' },
  { provider: 'openai', model: 'gpt-6-luna', endpoint: OPENAI_ENDPOINT,
    inputUsdPerMillion: 0.10, outputUsdPerMillion: 0,
    reference: 'https://developers.openai.com/api/docs/guides/decisions' },
];

export function nativePayload(provider, request, model) {
  if (provider === 'openai') return buildOpenAIPayload(request, model);
  if (provider === 'openrouter') return buildOpenRouterPayload(request, model);
  throw new Error('Unknown provider; choose openai or openrouter');
}

/** Public fictional inputs only. This is an inspectable proposal, never an execution permit. */
export function prepareDecisionPlan(corpora) {
  const packet = prepareRequests(corpora);
  const requests = DECISION_MODELS.flatMap(model => Object.entries(packet.tasks).flatMap(([task, data]) =>
    data.requests.map(item => {
      const payload = nativePayload(model.provider, item.request, model.model);
      const payloadBytes = Buffer.byteLength(JSON.stringify(payload));
      assert.ok(payloadBytes <= 65536, 'Public benchmark payload exceeds proposed 64 KiB limit');
      return { provider: model.provider, requestedModel: model.model, endpoint: model.endpoint, task,
        caseId: item.caseId, corpusHash: data.corpusHash, requestHash: item.requestHash,
        nativePayloadHash: fingerprint(payload), payloadBytes, questionCount: Object.keys(item.request.questions).length,
        smoke: corpora[task].cases.find(c => c.id === item.caseId)?.split === 'development' &&
          item.caseId === corpora[task].cases.find(c => c.split === 'development')?.id,
        payload };
    })));
  const smoke = requests.filter(r => r.smoke);
  const repeats = 3;
  const smokeQuestions = smoke.reduce((n, r) => n + r.questionCount, 0);
  const comparisonQuestions = repeats * requests.reduce((n, r) => n + r.questionCount, 0);
  return { version: 1, executionAllowed: false, priceCheckedAt: '2026-10-17', repeats,
    maxAttemptsPerCall: 1, proposedTimeoutMs: 30000, maximumPayloadBytes: 65536,
    models: structuredClone(DECISION_MODELS),
    counts: { smokeCalls: smoke.length, comparisonCalls: requests.length * repeats,
      maximumCalls: smoke.length + requests.length * repeats,
      smokeQuestions, comparisonQuestions, maximumQuestions: smokeQuestions + comparisonQuestions },
    billing: { proposedReviewBudgetUsd: 1, hardBillingCap: false, estimatedTotalUsd: null,
      assumptions: 'Rates are dated list prices, not a quote. Verify per-question billing, premiums, account limits and reported usage before approval. Bytes are not tokens.' },
    requiredBeforeExecution: ['Owner approves endpoints, public inputs and spending scope',
      'Verify account entitlement, billing and data terms without activating a new account',
      'Smoke confirms native schema, reported model identity, complete raw capture and usage',
      'Freeze payload hashes; stop on identity drift, rate limit or the authorised budget threshold'],
    requests };
}
