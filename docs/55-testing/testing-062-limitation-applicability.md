---
document_id: AIDHA-TESTING-062
owner: Engineering
status: Draft
version: '0.1'
last_updated: 2026-10-17
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
> **Version:** 0.1
> **Last Updated:** 2026-10-17
> **Type:** TESTING

# Source-Backed Limitation Applicability

## Version History

| Version | Date | Author | Change Summary | Reviewers | Status | Reference |
| ------- | ---- | ------ | -------------- | --------- | ------ | --------- |
| 0.1 | 2026-10-17 | Codex | Specify opt-in source-backed links and storage regressions. | — | Draft | AIDHA-PLAN-015 |

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
link. Unclear or conflicting proposals produce no attachment. Any malformed relation entry
skips the entire optional link set, while the
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
when a retained limitation and a target have affirmative grounded verdicts. Its full-source
prompt and response schema consume tokens. The existing token-ceiling preflight estimates the
next call's input and output capacity: if too little remains before the optional call, links
are skipped and the standalone claims are retained. If reported usage exceeds the ceiling
after the call, or the provider reports invalid token usage, the miner fails closed, as it
does for other calls. These estimates are not a billing guarantee, and the optional pass
does not support dollar ceilings.

## Acceptance and verification

- `packages/praecis/core/tests/extract/distill/limitations.test.ts` verifies shared full source
  context, target-specific exact evidence, retained limitation attribution, and rejection of
  nonliteral, generic, wrong-target-anchor, wrong-kind, and nonaffirmative proposals. An
  affirmative source paraphrase remains eligible; a source sentence with a negated target
  receives no link when the advisory model reports `unsupported`.
- `packages/praecis/core/tests/pipeline/limitation-applicability.test.ts` uses the shared runtime,
  fake model responses and SQLite close/reopen to verify two similar results A and B, a later
  A-only limitation with an unnamed origin, B without the link, and the limitation as an
  independent assertion. It also verifies distinct stored IDs when only limitation meaning
  changes while the target's own text and evidence stay constant.

Run from the repository root:

```sh
pnpm --dir packages/praecis/core exec vitest run tests/extract/distill/limitations.test.ts tests/pipeline/limitation-applicability.test.ts
pnpm --dir packages/praecis/core lint
node scripts/meminit-check.mjs docs/55-testing/testing-062-limitation-applicability.md
pnpm docs:build
```

These tests use public synthetic passages and local fake model replies. No external model or
private source is needed. They establish host gates, projection, and persistence, not real-world
model semantic accuracy.
