---
document_id: AIDHA-TESTING-062
owner: Engineering
status: Draft
version: '0.5'
last_updated: 2026-10-19
title: Source-Backed Limitation Applicability
type: TESTING
docops_version: '2.0'
area: CORE
related_ids: [AIDHA-PLAN-015, AIDHA-TESTING-058]
---
<!-- MEMINIT_METADATA_BLOCK -->
> **Document ID:** AIDHA-TESTING-062
> **Owner:** Engineering
> **Status:** Draft
> **Version:** 0.5
> **Last Updated:** 2026-10-19
> **Type:** TESTING

# Source-Backed Limitation Applicability

## Version History

| Version | Date | Author | Change Summary | Reviewers | Status | Reference |
| ------- | ---- | ------ | -------------- | --------- | ------ | --------- |
| 0.1 | 2026-10-17 | Codex | Specify opt-in source-backed links and storage regressions. | — | Draft | AIDHA-PLAN-015 |
| 0.2 | 2026-10-17 | Codex | Clarify hosted-review cleanup and retain the tested relation contract. | — | Draft | PR 42 |
| 0.3 | 2026-10-17 | Codex | Guard whole target labels and skip calls without claim-projected endpoints. | — | Draft | PR 42 |
| 0.4 | 2026-10-17 | Codex | Link acceptance criteria to the reviewed regression files. | — | Draft | PR 42 |
| 0.5 | 2026-10-19 | Codex | Extend limitation applicability through validated extraction checkpoints and JSON cache replay | — | Draft | PR 42 |

## Scope

`SourceDistillationMiner` may make one extra, opt-in advisory pass to propose a direct
`limits` attachment from a retained limitation unit to a retained target unit. Both endpoints
must have affirmative grounded verdicts; the source kind must be `limitation` and the target
must be a different, non-limitation claim kind. The relation decision
must cite an exact source quote containing a literal target anchor; that anchor must also appear
in the target's own cited evidence and must not label another retained claim. The model is asked
to judge whether the passage actually restricts the named target, including paraphrases and
later corrections. Host quote and anchor checks establish traceability, not that the judgement
is true. A known unit ID or a literal but unrelated quote cannot independently establish the
link. Unclear or conflicting proposals produce no attachment. Any malformed relation entry,
including unsupported fields at the response, relation or nested
evidence/scope boundary, skips the entire optional link set, while the
limitation remains its own draft assertion. All stored applicability carries `trusted: false`;
the exact-quote and lexical gates establish traceability, not semantic entailment. A qualified
claim's storage identity includes the limitation meaning, evidence, relation evidence, and
target scope so a same-worded claim with different qualifications cannot overwrite it.

This pass remains disabled by default. It does not change reader, continuity, UI, or provider
defaults. It does not certify that a model judged an endpoint or relation correctly. Conservatively
ambiguous labels, including a target label appearing in two claim citations, may leave a true
relationship unattached.

Opt in explicitly when injecting the miner into pipeline services:

```ts
const miner = new SourceDistillationMiner({ enableLimitationApplicability: true });
const services = createDefaultPipelineServices({ store, llm, miner, config });
```

The optional pass makes at most one additional model call after generation and grounding, only
when a retained limitation and a claim-projected target have affirmative grounded verdicts.
Supporting examples and non-runbook procedures cannot trigger a call by themselves. Its full-source
prompt and response schema consume tokens. The existing token-ceiling preflight estimates the
next call's input and output capacity: if too little remains before the optional call, links
are skipped and the standalone claims are retained. If reported usage exceeds the ceiling
after the call, or the provider reports invalid token usage, the miner fails closed, as it
does for other calls. These estimates are not a billing guarantee, and the optional pass
does not support dollar ceilings.

## Durable checkpoint and cache contract

Each extraction candidate explicitly stores `limitationApplicability`, containing the retained
`affirmativeGroundingIds` and a JSON `limitationsByTarget` record, including an empty record when
no links are accepted. New stored applicability/summary fields are strictly validated. Admission
rebuilds every attachment against retained units and the current source using the same host gates
as fresh extraction, then compares the entire map. Snapshot hashing and deterministic claim
projection include the map; enabled and disabled miners have distinct prompt identities. Invalid
cached maps cause fresh extraction, while invalid fresh candidates fail before graph writes.
This extension does not include PR44's segmented evidence or repair audit.

The required field and changed miner identity invalidate earlier cache/checkpoint records.
Affected resources need re-extraction; this greenfield repository provides no compatibility
migration for earlier checkpoint records.

## Acceptance and verification

- [The limitation contract tests][limitation-contract-tests] verifies shared full source
  context, target-specific exact evidence, retained limitation attribution, and rejection of
  nonliteral, generic, wrong-target-anchor, wrong-kind, and nonaffirmative proposals. An
  affirmative source paraphrase remains eligible; a source sentence with a negated target
  receives no link when the advisory model reports `unsupported`. Whole-anchor regressions reject
  `Trial 1` inside `Trial 1.5`, signed and Unicode-prefixed lookalikes, while admitting a qualified
  label and an ordinary punctuation boundary.
- [The runtime and persistence tests][limitation-runtime-tests] uses the shared runtime,
  fake model responses and SQLite close/reopen to verify two similar results A and B, a later
  A-only limitation with an unnamed origin, B without the link, and the limitation as an
  independent assertion. It also verifies distinct stored IDs when only limitation meaning
  changes while the target's own text and evidence stay constant. A limitation with only
  claim-ineligible example/procedure targets makes no relation call.

[limitation-contract-tests]: https://github.com/GitCmurf/AIDHA/blob/4a0c47fd0c9ecfba0f578518b381a94820472b19/packages/praecis/core/tests/extract/distill/limitations.test.ts
[limitation-runtime-tests]: https://github.com/GitCmurf/AIDHA/blob/4a0c47fd0c9ecfba0f578518b381a94820472b19/packages/praecis/core/tests/pipeline/limitation-applicability.test.ts

The current local runtime regression extends that historical pinned revision. It compares the
complete map through fresh runtime extraction, a new
runtime with a model that must not be called, JSON cache replay and SQLite close/reopen. It checks
both enabled/disabled cache orders, rehashed/reprojected map corruption, strict stored fields,
full graph preservation on fresh candidate rejection, and last-success preservation after invalid
optional-call token usage. The snapshot consistency tests retain official identity, JSON-wire and
routing checks.

Current local regression files:
`packages/praecis/core/tests/pipeline/limitation-applicability.test.ts` and
`packages/praecis/core/tests/extract/distill/snapshot-consistency.test.ts`.

Run from the repository root:

```sh
pnpm --dir packages/praecis/core exec vitest run tests/extract/distill/limitations.test.ts tests/pipeline/limitation-applicability.test.ts tests/extract/distill/snapshot-consistency.test.ts
pnpm --dir packages/praecis/core lint
node scripts/meminit-check.mjs docs/55-testing/testing-062-limitation-applicability.md
pnpm docs:build
```

These tests use public synthetic passages and local fake model replies. No external model or
private source is needed. They establish host gates, projection, and persistence, not real-world
model semantic accuracy.
