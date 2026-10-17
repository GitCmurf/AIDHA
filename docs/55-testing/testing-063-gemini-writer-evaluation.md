---
document_id: AIDHA-TESTING-063
owner: Engineering
status: Draft
version: '0.2'
last_updated: 2026-10-17
title: Native Gemini Writer Evaluation Route
type: TESTING
docops_version: '2.0'
area: CORE
related_ids: [AIDHA-TESTING-059, AIDHA-PLAN-010]
---
<!-- MEMINIT_METADATA_BLOCK -->
> **Document ID:** AIDHA-TESTING-063
> **Owner:** Engineering
> **Status:** Draft
> **Version:** 0.2
> **Last Updated:** 2026-10-17
> **Type:** TESTING

# Native Gemini Writer Evaluation Route

## Version History

| Version | Date | Author | Change Summary | Reviewers | Status | Reference |
| --- | --- | --- | --- | --- | --- | --- |
| 0.1 | 2026-10-17 | Codex | Add a bounded native AGY writer route over frozen public sources, with raw failed-call capture and host validation. | — | Draft | TESTING-059 |
| 0.2 | 2026-10-17 | Codex | Record the seven-call public trial, provisional completeness review and pre-grounding quote-length rejection. | — | Draft | Frozen public writer trial |

## Purpose and acceptance

Evaluate Gemini as a generative source-distillation writer, separately from typed Decisions
models. This route reuses the three fictional, assistant-authored sources and `runSemanticCase`
production miner/runtime path in TESTING-059. It does not change the default miner, prompts,
case labels, or production client. No new service account, API key, package dependency or paid
endpoint is introduced. Preparing this route makes no model call.

The offline client tests in `scripts/semantic-quality/agy-client.test.mjs` use an injected process
boundary. They require one source-only JSON request, at most three calls per case, exact selector
identity, raw NDJSON/stderr/exit capture before response parsing, consistent reported usage,
and failure on malformed JSON, refusal/error status, missing identity, tool/delegation steps,
nonzero exit or timeout. After forced termination the client waits for process close and stream
drain. If close never arrives, it releases stdio/child handles, marks the captured bytes incomplete
and rejects the call. The
existing miner enforces schema and quotations, while grounding is
advisory; the manual runner stops on any native failure even if that grounding stage keeps units. A
passing offline test proves adapter behavior, not Gemini semantic quality.

## Native protocol and limits

The confirmed local AGY selector is `gemini-3.8-flash-low`, not a generic Gemini Flash alias.
The recorded public-text smoke returned stream-json init/result events and a JSON code fence.
Current `agy -h` advertises `--json-schema`, but that smoke did not exercise the flag and did not
return `structured_output`. This route therefore uses prompt-constrained JSON and validates the
complete JSON object locally. It does not claim parity with Claude's schema-enforced
`--json-schema` route or a direct API response-format contract.

AGY runs from a fresh empty temporary directory with `--mode plan`, `--sandbox` and
`--disable-slash-commands`. The prompt forbids tools, browsing, file/command use and delegation;
the adapter rejects any observed tool/subagent step. The smoke init nevertheless advertised
tools, and warned that plan mode has no effect when slash expansion is disabled. These controls
do not prove that tools cannot run before a reply is inspected. Do not use private input on this
route. No native `maxTokens` contract has been verified; the three-call ceiling and 60-second
native/90-second wrapper timeouts are evaluation bounds, not a token or billing cap. The smoke
reported 12,647 input tokens for a tiny prompt and no cost field. Native context overhead,
effective context length and dollar cost remain unknown.

## Manual execution after review

The command below is deliberately absent from the root test script. Run it only after reviewing
this candidate and confirming the existing native AGY route is authorised for the public corpus:

```bash
node scripts/semantic-quality/agy-live.mjs --live /tmp/new-gemini-writer-records
```

An optional case ID runs one case. The output directory must not exist. The runner rebuilds
workspace dependencies before loading the production runtime, then writes each case once with
exclusive creation. A record includes requested selector, reported model, captured raw NDJSON,
stderr, exit/signal/timeout and capture-completeness metadata, reported usage, CLI version,
corpus/source/code hashes,
runtime report and persisted graph claims. A failed native call or failed-closed case stops the
remaining batch while retaining its record. This matters because production grounding is advisory
and can otherwise retain units after a transport failure. Labels are assistant-authored
expectations, not human gold, and one run does not establish model superiority.

## Recorded public trial

The reviewed harness ran all three frozen sources through the production miner and exporter.
Seven native calls completed, with no failed native call or failed-closed case. The public
`scripts/semantic-quality/gemini-measurements.json` records source-bound assessment, usage,
code/corpus hashes and private-capture digests. Original native records remain local.

Independent assistant review, checked by the parent agent, rated two of nine required criteria
complete, six partial and one missing. None of the fourteen specified forbidden distortions
appeared. These are provisional completeness and type judgments, not a factual accuracy rate
or human-adjudicated gold. Some qualifications survived only in separate or supporting units,
which does not make a complete independently retrievable graph claim. One sample, native
agent overhead and different schema enforcement prevent a model-only ranking against the
older Claude records.

The missing operations-lead conditional recommendation was generated with correct text and
origin, then rejected before grounding: its exact source quote used 41 of 75 excerpt tokens,
above the unchanged 50% quote-length gate. The grounding request never received that unit.
This was not a semantic rejection by the grounding model. The next bounded slice should select
concise exact source passages and reverify them, preserving both the gate and the audit trail.

Reported usage totals 105,617 input and 7,391 output tokens. Seven native durations sum to
54.649 seconds; this excludes local dependency builds and is not a direct API latency measure.
No provider cost was reported, so provider cost remains unknown. No production writer or default is selected
from this result.
