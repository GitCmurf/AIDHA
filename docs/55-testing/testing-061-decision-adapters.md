---
document_id: AIDHA-TESTING-061
owner: Engineering
status: Draft
version: '0.3'
last_updated: 2026-10-29
title: Offline Decision Provider Adapters and Comparison Proposal
type: TESTING
docops_version: '2.0'
area: CORE
related_ids: [AIDHA-PLAN-015, AIDHA-TESTING-059, AIDHA-TESTING-060]
---
<!-- MEMINIT_METADATA_BLOCK -->
> **Document ID:** AIDHA-TESTING-061
> **Owner:** Engineering
> **Status:** Draft
> **Version:** 0.3
> **Last Updated:** 2026-10-29
> **Type:** TESTING

# Offline Decision Provider Adapters and Comparison Proposal

## Version History

| Version | Date | Author | Change Summary | Reviewers | Status | Reference |
| --- | --- | --- | --- | --- | --- | --- |
| 0.1 | 2026-10-17 | Codex | Translate frozen decision tasks, replay native replies offline and prepare a bounded live comparison proposal. | — | Draft | AIDHA-TESTING-060; owner autonomous preparation |
| 0.2 | 2026-10-29 | Codex | Integrate the strengthened checkpoint and qualify the bounded offline provider contracts. | — | Draft | PR 39 |
| 0.3 | 2026-10-29 | Codex | Pin reviewed capture controls and align with the merged checkpoint. | — | Draft | PR 39; PR 38 |

## Purpose and acceptance

Prepare the comparison in AIDHA-TESTING-060 without activating an account, reading credentials,
sending requests or changing production defaults. The tools have no HTTP transport or live
switch. Their inputs are the frozen public fictional corpora. Synthetic reply tests prove
adapter and scoring behavior; they supply no model-quality, price or latency measurement.

- Translate normalized choice questions to each provider's documented native request shape.
  Send source evidence, taxonomy and rubric only; exclude case IDs, split and expected labels.
- Preserve identical category choice descriptions across routes. Keep grounding criteria intact.
- Enforce exact named-question coverage, valid choices and finite probability distributions when
  reported. Keep explicit unknown, refusal and error distinct. Retain complete native replies,
  reported identity and usage. Missing costs remain null; never infer zero from a free output rate.
- Bind every capture to corpus, normalized request and canonical native payload hashes. Reject partial,
  duplicated, changed-input or mixed-identity batches before scoring. Never substitute a requested
  model alias for a missing reported identity.
- Prepare an inspectable request plan with separate HTTP-call and question counts, dated rates
  and explicit approval requirements. A generated plan confers no execution authority.

The direct offline acceptance tests are:

- [openai.test.mjs](https://github.com/GitCmurf/AIDHA/blob/6e35403d9825b246cd61c777ec4a60b5efe132cb/scripts/decision-quality/openai.test.mjs)
- [openrouter.test.mjs](https://github.com/GitCmurf/AIDHA/blob/6e35403d9825b246cd61c777ec4a60b5efe132cb/scripts/decision-quality/openrouter.test.mjs)
- [capture.test.mjs](https://github.com/GitCmurf/AIDHA/blob/6e35403d9825b246cd61c777ec4a60b5efe132cb/scripts/decision-quality/capture.test.mjs)
- [plan.test.mjs](https://github.com/GitCmurf/AIDHA/blob/6e35403d9825b246cd61c777ec4a60b5efe132cb/scripts/decision-quality/plan.test.mjs)
- [adapters.test.mjs](https://github.com/GitCmurf/AIDHA/blob/6e35403d9825b246cd61c777ec4a60b5efe132cb/scripts/decision-quality/adapters.test.mjs)

 Existing corpus and
scorer tests remain in the same root test command. This slice depends on AIDHA-TESTING-060 and is
integrated with its merged checkpoint through the ordinary main-branch workflow.

## Native API contracts

The [OpenAI Decisions guide](https://developers.openai.com/api/docs/guides/decisions) and
[create reference](https://developers.openai.com/api/reference/resources/decisions/methods/create)
specify shared `input` plus a named question array. The adapter JSON-serializes source state to
text and converts options to `{value, description}` entries. Replies contain named choice or
refusal answers; choice probability entries use value/probability pairs. OpenAI usage is retained
but cost stays unknown because this adapter does not calculate an invoice from token counts.

The official create reference checked on 29 October now permits 400 questions and additional
typed inputs. This offline adapter deliberately retains its tested 200-question/string-choice
subset for the frozen one-question and five-question tasks. It does not claim complete coverage
of every current API input type or capacity limit. No live provider acceptance is established
by the synthetic fixtures.

The [OpenRouter Decisions reference](https://openrouter.ai/docs/api/api-reference/alphadecisions/submit-a-decisions-request)
and [Jev examples](https://openrouter.ai/blog/insights/what-is-jev/) specify `state` and keyed
`questions` with descriptive `criteria`. Replies contain keyed choices and probability objects.
The adapter preserves a valid reported `usage.cost`. Explicit refusal and service-error replies
remain failures, rather than being converted into a valid unknown choice. The adapters validate
reported probabilities with small rounding tolerances; they do not use confidence to invent a
calibrated deployment threshold.

## Offline use and capture format

```bash
pnpm build:deps
pnpm test:decision-quality
pnpm decision:plan /tmp/new-decision-plan.json
node scripts/decision-quality/adapters.mjs --normalize-native openrouter grounding typesafe/jev-1.14 /tmp/native-captures.json /tmp/new-receipts.json
node scripts/decision-quality/run.mjs --replay grounding /tmp/new-receipts.json /tmp/new-score.json
```

Destinations must be new files. Each capture has `caseId`, `corpusHash`, `requestHash`,
`nativePayloadHash`, explicit `evidenceKind` (`synthetic` or `recorded-provider`), `rawReply`
and `durationMs` (nonnegative or null). Copy the three hashes from the exact planned request.
Keep the original capture file; the normalizer does not rewrite it. No authorization headers,
keys or account configuration are part of this format. Hashes canonicalize object keys: they bind
payload data, not exact serialized wire bytes. They detect changed inputs and translation; they
are collector provenance, not provider-authenticity proof.

A reply without reported model identity blocks the batch. Retain the original failed capture
and investigate identity or collection, rather than publishing a partial score. Even an identified
failure remains in the all-case accuracy denominator. Changing a reported model identity within a batch
also blocks scoring; aliases may hide weight updates, so an unchanged reported identity does not
prove immutable weights; separate runs must not be pooled as if they were the same model.

## Bounded live comparison proposal

The generated plan is a proposal requiring separate review. It selects these routes, with list
rates checked on 17 October 2026:

| Requested model | Endpoint | Input / output USD per million tokens |
| --- | --- | --- |
| [Jev 1.14](https://openrouter.ai/typesafe/jev-1.14) | OpenRouter `/api/alpha/decisions` | 0.042 / 0 |
| [Microsoft-Decision-1](https://openrouter.ai/microsoft/microsoft-decision-1) | OpenRouter `/api/alpha/decisions` | 0.042 / 0 |
| [GPT-6 Luna](https://developers.openai.com/api/docs/guides/decisions) | OpenAI `/v1/decisions` | 0.10 / 0 |

Use one development case per task/model for an initial schema and identity smoke check: six
HTTP calls containing eighteen questions. If the smoke is valid, run both sixteen-case tasks
three times per model: 288 further calls containing 864 questions. Total maximum: 294 calls and
882 questions, with one attempt per planned call, no automatic retries and a proposed thirty
second timeout. The generated plan includes exact native payloads, byte counts and hashes.
Repeating a stopped batch falls outside this one-attempt proposal and requires a new
bounded approval.
Each payload must be at most 64 KiB. Bytes are not a token estimate or a billing limit.

Recommend a USD 1 review budget for this deliberately small experiment, subject to account and
route verification before approval. This is not a hard provider billing cap or a cost estimate.
Verify per-question input billing, premiums, account limits, data handling and usage reporting;
stop on drift, rate limiting or the approved spending threshold. No account or paid service has
been activated. Do not infer a free account from zero output-token pricing. Keep development
and held-out results separate, retain failures, and compare critical false acceptance before
choosing any deployment candidate. The labels are provisional assistant judgments, not human gold.

## Historical writer-model preparation, 17 October 2026

The owner identified Gemini 3.8 Flash as an extraction and summary candidate. It is a general
generative model. Its [official model documentation](https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash)
reports a 1,048,576-token input limit and 65,536-token output limit, with structured output.
These Developer API limits do not establish the effective context available through a native
agent CLI. Evaluate source-to-distillation quality separately from these typed decision tasks.

Local `agy models` lists low, medium and high selectors. One corrected source-only capability
smoke using `gemini-3.8-flash-low` succeeds with JSON in a code fence and no tool or subagent
steps. The initial attempt failed during CLI argument parsing, before inference; both attempts
are retained privately. The successful run reports 12,647 input and 31 output tokens for a tiny
fictional prompt, and no cost field. This indicates substantial native-agent context overhead; it
cannot substantiate direct API costs, a native one-million-token limit or extraction quality.
The next writer comparison should reuse the frozen source-only cases from AIDHA-TESTING-059, record
native overhead and actual model metadata, and retain schema/grounding failures. No source
extraction run or change to production model selection is included here.

Any writer collection remains a separate reviewed task. This offline adapter qualification
uses no credentials and does not establish account access, entitlement or a production model choice.

## Current checkpoint integration

The adapter slice integrates the reviewed parent checkpoint at efaf65f0. All eleven inherited
checkpoint, scorer and data files are byte-identical to that parent. The expanded root offline
command retains every earlier decision test and the complete public-safety, semantic-quality and
serial workspace test chain. No production source or dependency resolution is changed here.

Current API documentation confirms the named-array OpenAI and keyed-question OpenRouter shapes
used by this bounded choice-only contract. Candidate rates remain the dated proposal above;
they have not been promoted to current price quotes, measured quality or approved expenditure.
Frozen installation, offline tests on supported runtimes, strict docs, scoped DocOps and final
peer/hosted checks remain qualification gates.

## Completed offline qualification

The checkpoint and adapter command passes 58 tests on Node 22.21.1 and official Node 22.12.0.
Five-question category batches exercise both routes through capture normalisation and scoring:
one OpenAI refusal or malformed OpenRouter answer denies the complete case empty-set credit,
while the original reply remains intact. The inherited root-script contract also passes all
four cases without dropping a prior stage or serial package dispatch.

A mixed synthetic/recorded-provider batch is rejected by the parent's complete identity tuple,
which includes evidenceKind. A synthetic fixture explicitly exercises the recorded-provider
metadata path as well: the quality flag remains a collector assertion against provisional labels,
not proof that a real provider was called. These fixtures make no live quality measurement.

The configured route and reported model are retained separately. A consistent reported identity
does not prove the requested model or approved immutable weights ran; a future collector must
stop and investigate route/model drift under its separate authority.

## Merged checkpoint alignment

PR 38 is merged as main 7fd5fe97. Its complete file tree equals the qualified parent used here.
Ordinary main synchronisation preserves the entire reviewed adapter tree, including all 58
offline controls; only this evidence record and catalogue are then refreshed for source pins.
Application package source and dependency resolutions remain byte-identical to merged main.

The complete 2,351-test package verification belongs to that parent checkpoint. This slice's own
qualification covers its 58 offline cases on both runtimes, four root-script controls, strict
docs/DocOps and exact-file hooks. A further complete local package rerun is not claimed.
Final exact-head GitHub checks and actual reporting-bot reviews remain the landing gate.
