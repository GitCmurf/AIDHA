---
document_id: AIDHA-TESTING-060
owner: Engineering
status: Draft
version: '0.3'
last_updated: 2026-10-29
title: Categorisation and Evidence Decision Quality Checkpoint
type: TESTING
docops_version: '2.0'
area: CORE
related_ids: [AIDHA-PLAN-015, AIDHA-TESTING-058]
---
<!-- MEMINIT_METADATA_BLOCK -->
> **Document ID:** AIDHA-TESTING-060
> **Owner:** Engineering
> **Status:** Draft
> **Version:** 0.3
> **Last Updated:** 2026-10-29
> **Type:** TESTING

# Categorisation and Evidence Decision Quality Checkpoint

## Version History

| Version | Date | Author | Change Summary | Reviewers | Status | Reference |
| --- | --- | --- | --- | --- | --- | --- |
| 0.1 | 2026-10-17 | Codex | Freeze separate public category and evidence tasks, measure persisted keyword assignments, and validate offline decision receipt scoring. | — | Draft | AIDHA-PLAN-015; owner model refresh |
| 0.2 | 2026-10-29 | Codex | Integrate current main and retain both offline preflights and serial dispatch. | — | Draft | PR 38 |
| 0.3 | 2026-10-29 | Codex | Require completed classification and verify stored provenance before baseline credit. | — | Draft | PR 38 |

## Purpose and boundary

Measure the current categorisation baseline and prepare identical evidence-judgment tasks for
current typed decision models. Keep authoring and repair separate: a choice of `rewrite` requests
work from a writer; it does not supply or validate repaired prose. These are newly authored
fictional examples and provisional assistant-reviewed labels, not human gold or an estimate of
real-world accuracy. Development and held-out subsets are inspectable; their public availability
means they cannot serve as a permanently private evaluation set.

This slice uses existing production interfaces and leaves production behavior unchanged.
Categorisation enters through configured pipeline services and the shared ingestion runtime;
its measured result is the stored Resource taxonomy assignment. Grounding requests use the
production distillation schema and literal evidence verifier before any semantic verdict.
Exact quotation is a necessary precondition, not proof that the draft follows from its source.
No model, network, credential, private-source, account or billing operation is part of this slice.

## Acceptance criteria

- Freeze separate category and grounding corpora with source-visible fields separated from
  expected labels, rationale, split and critical-error annotations.
- Run the actual keyword classifier through the shared runtime with isolated stores, fixed time
  and explicit public fixture input. Read assigned tag IDs from persisted Resource metadata.
- Include multi-label, synonymous, overlapping, unknown-topic, negation and incidental-word cases.
  Preserve baseline mismatches in the report; tests must not require a known bad classification.
- Verify all grounding decision cases pass the production literal/schema gate. Include supported,
  repairable and unsupported drafts, later corrections, attribution, measured outcomes and a
  literal quotation whose context contradicts the draft. Nonliteral evidence is blocked first.
- Represent category decisions per tag as applies, not applicable or unknown. Represent evidence
  judgments as grounded, rewrite, ungrounded or unknown. Preserve refusal and error distinctly.
- Bind replay receipts to the whole corpus/rubric and exact model-visible request hashes.
  Reject duplicates, missing cases, invalid choices and changed inputs instead of scoring them.
- Report per-tag precision/recall and exact-set accuracy; report grounding confusion, false
  acceptance, critical false acceptance, repairable rejection and abstention separately.
  Define every denominator. An empty assignment is not automatically an uncertainty signal.
- Preserve raw replies and known usage/cost/timing. Missing measurements remain unknown;
  synthetic adapters validate plumbing and cannot establish model quality, cost or latency.
- Do not rank current models from older Jev records or mock replies. No provider integration,
  production selection or default change is included. Live collection needs a bounded authorised
  endpoint and cost/disclosure plan before execution.

## Validation

Acceptance tests cover [runtime collection](https://github.com/GitCmurf/AIDHA/blob/b482239fd6461fdddde0d60b31bbb95c72d2f664/scripts/decision-quality/category.test.mjs),
[literal grounding](https://github.com/GitCmurf/AIDHA/blob/b482239fd6461fdddde0d60b31bbb95c72d2f664/scripts/decision-quality/grounding.test.mjs),
[receipt validation/scoring](https://github.com/GitCmurf/AIDHA/blob/b482239fd6461fdddde0d60b31bbb95c72d2f664/scripts/decision-quality/quality.test.mjs)
and
[artifact/CLI behaviour](https://github.com/GitCmurf/AIDHA/blob/b482239fd6461fdddde0d60b31bbb95c72d2f664/scripts/decision-quality/run.test.mjs).
Run the existing
`pnpm build:deps` first. CI already builds workspace packages before the root offline tests.
The benchmark records known baseline defects; passing tool tests certify measurement behavior,
not successful categorisation or semantic fidelity. The final report must retain per-case
errors and label limitations so aggregate scores cannot hide critical mistakes.

The workflow and PR description record exact commands, dated report results and review limits.

## Commands and receipt format

```bash
pnpm build:deps
pnpm test:decision-quality
pnpm decision:baseline /tmp/new-keyword-report.json
pnpm decision:requests /tmp/new-decision-requests.json
node scripts/decision-quality/run.mjs --replay grounding /tmp/receipts.json /tmp/new-report.json
```

Use a fresh destination: output writes fail if the file already exists. `--baseline` measures
stored keyword assignments. `--requests` exports two task packets; a future collector sends only
the source/rubric fields inside each entry's normalized `request` to a model, never its case ID
or labels. A collector must map the normalized questions to the provider's actual schema.
`--replay` accepts normalized
receipts; there is deliberately no provider-specific transport or live switch in this slice.

Each receipt has task, caseId, corpusHash, requestHash, requestedModel, resolvedModel, endpoint,
evidenceKind, status, answers, rawReply, usage, costUsd and durationMs. Hashes bind the complete
corpus (including labels/rubric) and exact visible request. Answers are an array of
`{questionId, choice}`. Category question IDs are taxonomy tag IDs; the evidence question is
`verdict`. Successful receipts need exactly one valid answer per question. Refusal/error receipts
can retain partial answers and raw data, but failed decisions earn no classification credit.
Use explicit null for unknown endpoint, usage, cost or timing; do not manufacture zero values.

Evidence kinds are `keyword-baseline`, `recorded-provider` and `synthetic`. Synthetic replay is
plumbing evidence only. Receipt metadata is provenance supplied by a collector, not independent
proof that a provider produced a reply. Keep complete raw records and verified model identities
when a separately authorised collection is implemented. Hash binding detects changed inputs;
it does not authenticate a provider or certify the provisional labels.

The report's modelQualityMeasured flag denotes collector-declared recorded-provider
replies scored against these provisional labels. It does not authenticate the provider or
turn the labels into human gold.

## Recorded keyword baseline

The public [keyword baseline](https://github.com/GitCmurf/AIDHA/blob/b482239fd6461fdddde0d60b31bbb95c72d2f664/scripts/decision-quality/keyword-baseline.json)
contains the projected stored
assignments, classification reports, receipts, per-case errors and split-specific counts.
This deliberately constructed challenge set
contains eight development and eight held-out examples. It is not sampled to estimate production
prevalence or overall categorisation accuracy. Both subsets are public and assistant-reviewed.

| Observation | Result |
| --- | --- |
| Exact tag-set matches | 12/16 overall; 8/8 development and 4/8 held-out |
| Positive tag decisions | 15 true positives and three false positives |
| Missing expected tags | One false negative |
| Micro precision / recall | 15/18 and 15/16 |
| Explicit abstention | None; this keyword matcher does not express uncertainty |
| Complete empty assignments | Three; an empty set is separate from abstention |
| Current model comparisons | None; no new model calls were made |

The four mismatches are a negated incident mention (`cat09`), incidental accessibility guidance
in an unrelated procedure (`cat10`), retention expressed without configured vocabulary (`cat13`),
and negated deployment/release terms adding release to a capacity source (`cat14`). These
demonstrate specific baseline limitations. They do not show that a newer model fixes them.

The runtime supplies no generated claims or source-summary enrichment: the source label and
body reach the keyword classifier as raw label and one chunk. The model-visible packet shares
those source facts and adds taxonomy hierarchy plus decision instructions. The comparison is
between mechanisms on shared source material, not identical internal context or computation.
Tests inspect actual stored assignments and allow future classifier improvements.

## Scoring and rubric limits

Category exact-set accuracy divides fully correct, non-abstaining cases by every case. Per-tag
precision is TP/(TP+FP); recall is TP/(TP+FN), where a missed positive includes abstention.
Micro counts pool tags. Undefined denominators return null. Unknown tag decisions and failed
cases cannot earn correct empty-set credit; complete all-negative decisions can.

Grounding all-case accuracy counts correct verdicts over every case; answered accuracy excludes
unknown/refusal/error, and coverage reports that answered fraction. The confusion table keeps
all those outcomes visible. Only explicit unknown choices count as abstention; refusals and
errors are separate failed decisions, kept in the all-case denominator. False acceptance means
`grounded` for expected rewrite/ungrounded;
critical false acceptance is its annotated subset. Repairable rejection means `ungrounded` for
expected rewrite. These are rubric disagreements, not validated estimates of real-world harm.

A sourced core observation can merit rewrite when its method or origin is wrong. For example,
participant survey feedback mislabeled as an independent usability test is repairable under
this rubric because the positive assessment remains sourced. A claim whose central event,
outcome or mechanism is unsupported needs rejection. This boundary was independently reviewed
and remains provisional. Typed judgments do not create repaired text or endorse projection.
Instructions were shaped after reviewing the public held-out examples; that split is not blind
to rubric development and needs fresh independently adjudicated cases before generalisation.

Cost totals are known only when every receipt records cost. Partial sums retain a separate known
count; missing costs stay unknown. Latency p50/p95 use nearest-rank percentiles over the recorded
sample and report its count. Never present mock times or partial samples as provider performance.

## Review and next measurement

Independent assistant review removed a visible taxonomy-answer cue, clarified an ambiguous
retention/accessibility source, and reconciled the method/origin rewrite boundary before these
receipts were frozen. Red/green corrections cover nested reviewer-field leakage, missing task
questions and duplicate expected tags producing false exact-set credit.

Before live comparison, select exact endpoints/model versions, normalize each real schema,
review public input and per-question/context billing, and set bounded request/token/cost limits.
Measure actual outputs, failures, usage, retries, fallback and latency on the same frozen tasks.
Keep generation and prose repair in a separate comparison. Production promotion still requires
repeatable semantic benefit, additional independently adjudicated cases and later owner review.

The baseline identity hashes the compiled module containing `KeywordTaxonomyClassifier` and
its matching/normalization helpers; it does not identify every runtime dependency. Its public
receipt projects stored assignment fields needed to audit the scores and explicitly omits the
redundant vocabulary fingerprint flagged by the unchanged secret scanner. The corpus hash still
binds the vocabulary, and the original full local runtime capture is retained privately. This
projection changes neither persisted metadata nor classifier decisions. Snapshot checks reconcile
stored tag IDs with normalized answers, recompute per-case rows, and compare a fresh report when
the classifier module identity matches. Historical evidence can remain when that identity changes;
tests do not require preserving known incorrect classifier behavior.

## Current-main integration, 2026-10-29

Integration starts from merged main ff052ba8, including the qualified runtime/dependency
maintenance, acquisition and diagnostic boundaries. The root test command retains public-safety
and semantic-quality checks and exhaustive serial workspace dispatch, adding this independent
decision-quality preflight. The root-script contract first rejects the new unrecorded stage,
then passes with that stage explicitly included; no existing stage or package suite is removed.

AIDHA-PLAN-015 retains the current standing technical authority and all separate owner decision gates.
Older branch snapshots are not reintroduced as current status. Current verification and peer/bot
assessment remain required before landing this refreshed checkpoint.

## Completed classification and observation checks

A successful ingestion report alone cannot establish a completed classification. The collector
now requires completed classification without warnings, valid integer counts bounded by the
vocabulary size, and equal matched/assigned/unique stored-assignment counts in each fresh store.
An absent assignment field becomes an empty projected array only after verified completion with
zero matches. Replay always requires an explicit projected array and the classification report;
a missing or null observation cannot silently earn empty-set credit.

Before collection, configured matching vocabulary must equal the supplied corpus. Every present
assignment must belong to its Resource, use the automatic keyword classifier identity and fixed
observation time, and carry the expected vocabulary fingerprint. Only then is that fingerprint
omitted from the public projection. rawReply.classification retains completed status, counts
and warnings; taxonomyVersionVerified records the collector's vocabulary/fingerprint check.
Replay validates the declared report, projected assignment provenance and verification marker.
It cannot independently revalidate omitted fingerprints or authenticate the collector.

The offline-only service-factory seam exercises disabled/warned/error reports, impossible or
inconsistent counts, missing positive writes, wrong vocabulary, and corrupt persisted ownership,
origin, time and fingerprints through the actual runtime. A completed zero-match control remains
valid. Unexpected fetch calls fail the collection tests. There is no new production switch.

The first five negative collection cases reproduce before wiring the stricter observation
boundary. Removing only the completed-observation validation after wiring reproduces failures;
byte-identical restoration passes the checkpoint. The expanded 34-test suite also passes on
Node 22.21.1 and official Node 22.12.0, including direct replay report/marker
corruption controls. Replay also reproduces
foreign/manual/wrong-classifier acceptance before correction and rejects it afterwards.
Regenerating the public receipt adds the verification evidence while preserving every per-case
result, split total and score: 12/16 exact tag sets, with the same four mismatches.

The classification module digest still identifies only the named compiled module. A changed
identity now emits an explicit historical-baseline message; it does not establish whole-stack
identity or model improvement. Final supported-runtime, public-safety, documentation and hosted
checks remain completion gates.

The refreshed classifier digest identifies the currently built main module, whose bytes match
the separately qualified main baseline. PR 38 changes no production source path. The changed
digest relative to the older public receipt therefore does not represent a new classifier
implementation in this slice.
