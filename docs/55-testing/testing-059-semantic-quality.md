---
document_id: AIDHA-TESTING-059
owner: Engineering
status: Draft
version: '0.2'
last_updated: 2026-10-17
title: Source Distillation Semantic Quality Checkpoint
type: TESTING
docops_version: '2.0'
area: CORE
related_ids: [AIDHA-PLAN-015, AIDHA-TESTING-057, AIDHA-TESTING-058]
---
<!-- MEMINIT_METADATA_BLOCK -->
> **Document ID:** AIDHA-TESTING-059
> **Owner:** Engineering
> **Status:** Draft
> **Version:** 0.2
> **Last Updated:** 2026-10-17
> **Type:** TESTING

# Source Distillation Semantic Quality Checkpoint

## Version History

| Version | Date | Author | Change Summary | Reviewers | Status | Reference |
| ------- | ---- | ------ | -------------- | --------- | ------ | --------- |
| 0.1 | 2026-10-17 | Codex | Freeze a public semantic checkpoint, record live failures and separate unproven semantic changes. | — | Draft | AIDHA-PLAN-015 |
| 0.2 | 2026-10-17 | Codex | Retain complete parsed native replies and usage on failed calls, with two regression paths. | — | Draft | PR 37 bot finding |

## Purpose and acceptance

Measure whether distillation preserves useful meaning before changing default selection or
expanding reader features. The checkpoint includes three fictional public multi-excerpt sources,
nine required propositions and fourteen forbidden distortions. Expectations were authored before
the first model run and independently reviewed by another assistant. They are not human gold.
A selected synthetic set cannot establish general model quality or owner usefulness.

For each required proposition, accept equivalent wording and inspect its source-stated reasons,
scope, period, comparator, origin and evidence limits in the reusable result or explicitly linked
context. Mark partial when material meaning survives only in separate, unlinked units or conflicts
with metadata. Record omissions, invented assertions, procedural leakage, duplicates and projection
losses separately. Literal evidence and excerpt citation coverage do not measure semantic recall.
All nine required items must be met without a forbidden distortion or procedural graph claim for
this provisional checkpoint to pass. Passing it alone would not justify changing the default.

The existing YouTube rubric and gold-matching tools inform this review. They cannot provide its
acceptance score: text similarity does not establish preservation of qualifications or attribution.
The checkpoint uses inspected model output rather than a new automated semantic judge.

## Recorded result

`measurements.json` holds reviewed ratings, actual claim/supporting-unit snapshots for the
controlled baseline and fresh experiment, model identity, invocation counts and raw-record hashes.
Digest values use explicit `sha256:` and `git:` identifiers; they are hashes of public inputs, not
credentials.
The corpus is `cases.json`; both files live under `scripts/semantic-quality/`.

| Controlled variant | Met | Partial | Missed | Listed forbidden distortions |
| --- | --- | --- | --- | --- |
| Baseline: `5b81d23` prompt content | 6 | 3 | 0 | 0 |
| First semantic experiment | 7 | 2 | 0 | 0 |
| Fresh expanded experiment | 6 | 3 | 0 | 0 |

The experiments do not establish a stable quality gain and do not pass the checkpoint. Their
prompt, kind-rewrite and relationship changes remain local on `026-semantic-grounding`; this PR
contains only the evaluation tools, sources, recorded evidence and workflow. Production extraction,
grounding contracts and default selection are unchanged by this checkpoint.

Observed problems include a result detached from its observation window, a recommendation detached
from its source-stated reason, and trial text naming the tester while metadata identifies its
reporter. A preliminary queue result survives alongside its later correction in the baseline.
Some experiments repair these but reintroduce other losses. Source-level semantic consolidation
and qualification/origin relationships deserve investigation before more prompt-only tuning.

The baseline replays byte-identical `5b81d23` prompt content from the `f994fa0` checkout;
its raw record correctly identifies that checkout and the restored prompt hash. It is a prompt
overlay, not a claim that the runner checked out main.

The baseline and both controlled experiments used `claude-sonnet-5-5`, low effort and the same
frozen corpus hash. Each variant has one complete sample. This is a dated comparison of specific
source/prompt revisions, including a combined context/prompt experiment; it does not isolate every
change or estimate a statistical effect. Human adjudication and held-out real-source evaluation
remain necessary. Raw receipts are retained privately; published snapshots contain synthetic text.

## Failed exploratory variants

The first native adapter omitted schema controls. Its candidate failed closed after one repair
invented a condition type. The first schema-forwarding attempt then failed because the CLI rejected
the generated schema's dialect URI. Both failures are retained and disclosed in the measurement
artifact. They are not paired with the later controlled candidate or removed as inconvenient runs.

The adapter now removes only the unsupported dialect URI, retains the generated object and enum
constraints, forwards `--json-schema`, and consumes `structured_output`. Host validation remains
authoritative; structural CLI validation does not replace host semantic/schema refinements.
A frozen-generation replay with one new grounding invocation restored trial scope and tester
attribution, but left the supplier proposal unchanged. That replay did not establish fresh
end-to-end generation quality.

## Runner and data boundaries

`run.mjs` passes source fields through the actual `SourceDistillationMiner`, runtime and graph
exporter in an isolated in-memory store. It returns claims, supporting/rejected units, diagnostics
and exact persisted Claim snapshots. Expectations are added after extraction and never enter
mining requests. The offline test uses a synthetic case with the corpus's `expected` field name
and checks that
neither prompt contains its expectation sentinel.

`live.mjs` is an explicit manual adapter for an existing authenticated native Claude subscription.
It disables tools, MCP servers, hooks and repository customizations. The adapter does not inspect
or copy credentials; the native CLI uses its own authenticated session. No private original
source, new account, API route or service activation is used.

Each run rebuilds core and its workspace dependencies before loading compiled modules, records
model/CLI/code identity and
execution-file hashes, marks dirty state, and refuses to overwrite results. It permits at most
three CLI invocations per case and times out each after 120 seconds. The CLI can make multiple
internal model turns per invocation. This is not a provider-call or billing cap; the native CLI
does not implement the client request's `maxTokens` limit. Baseline execution hashes have a
post-run supplement captured from files unchanged during that run. Native results do not establish
API-provider parity or repeatability across model updates.

Run evidence remains outside tracked paths until its synthetic content is inspected. Preserve
failed cases. Repeated runs need fresh output directories; record changes to models, controls,
source hashes and labels explicitly. Do not rerun silently until an attractive result appears.

## Verification and reproduction

```sh
pnpm build:deps
pnpm test:semantic-quality
node scripts/semantic-quality/live.mjs --live /tmp/aidha-semantic-fresh
```

The offline suite checks the actual runtime/exporter, expectation isolation, exact untrusted
qualification/evidence persistence, native schema forwarding, usage accounting, dialect adaptation
and rejection of prose in place of a required structured result. Complete parsed native replies,
including available usage and duration, survive both native error replies and missing structured
results. Spawn or JSON-parse failures retain the existing partial-call/error record.
Root `pnpm test` includes it;
CI builds workspace packages first and never invokes the live script. Offline tests do not grade
semantic accuracy. Local tests also require the documented dependency build first.

A new run evaluates its checked-out source revision. Recorded historical variants use their
recorded prompt versions and source hashes, rather than silently being relabeled as a current
baseline. All changed execution files must be recorded when experimenting on an uncommitted tree.

## Next semantic sprint and owner review

Freeze repeated-run and held-out criteria, investigate typed limitation/origin links through
projection and storage, and use a stronger or more deliberate semantic judge only when measured
results justify it. Keep measurement budgets and model changes visible. The stable tools can land
while experimental semantic changes remain held until they meet their acceptance criteria.

The owner can inspect the queue result and supplier-trial snapshots against their short source
passages. That concrete review is useful calibration; labeling the whole corpus is not required
before engineering continues. Before claiming reader benefit, show a real answer with the correct
result, qualifications, source and passage retained after storage and retrieval. Default selection
and real-source disclosure/spending retain their existing gates.
