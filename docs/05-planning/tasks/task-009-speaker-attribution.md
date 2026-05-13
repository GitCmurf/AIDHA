---
document_id: AIDHA-TASK-009
owner: Ingestion Engineering Lead
status: Draft
version: "0.1"
last_updated: 2026-05-13
title: Speaker Attribution Pipeline
type: TASK
docops_version: "2.0"
area: INGEST
keywords: [speaker-attribution, transcripts, provenance, extraction, auditability]
related_ids: [AIDHA-TASK-003]
---

<!-- markdownlint-disable MD013 -->
<!-- MEMINIT_METADATA_BLOCK -->

> **Document ID:** AIDHA-TASK-009
> **Owner:** Ingestion Engineering Lead
> **Approvers:** —
> **Status:** Draft
> **Version:** 0.1
> **Last Updated:** 2026-05-13
> **Type:** TASK

# Task: Speaker Attribution Pipeline

## Version History

| Version | Date       | Author | Change Summary | Reviewers | Status | Reference |
| ------- | ---------- | ------ | -------------- | --------- | ------ | --------- |
| 0.1     | 2026-05-13 | AI     | Split the deferred speaker-attribution work out of TASK-003 and turn it into a focused implementation task list. | — | Draft | AIDHA-TASK-003 |

## Purpose

This task captures the work that was intentionally deferred from TASK-003: preserving speaker
provenance from transcript parsing through ingestion and into extraction payloads and downstream
outputs.

Speaker attribution is not the same problem as claim extraction quality. The extraction system can
be correct without it, but multi-speaker videos lose auditability when the speaker label is dropped.
This task is therefore scoped as a separate engineering slice with its own tests, docs, and rollout
criteria.

## Scope

This task covers:

- transcript schema support for optional speaker metadata;
- transcript parsing for common speaker-label formats;
- ingestion-time preservation of speaker provenance;
- propagation of speaker metadata into the claim-extraction prompt payload;
- downstream tests, docs, and fixtures that prove the behavior end to end.

This task does not cover:

- automatic diarization from raw audio;
- named-entity speaker resolution across arbitrary transcript sources;
- full reprocessing of all historical corpus artifacts unless a test explicitly needs it;
- extraction-quality tuning unrelated to provenance preservation.

## Dependencies

This task depends on the closed TASK-003 extraction-quality plan and on the existing YouTube
ingestion/extraction modules remaining stable enough to accept an optional speaker field without
changing the transcript text or timestamps.

## Completion Plan

### Workstream 1: Schema and contract updates

1. Add an optional `speaker?: string` field to the transcript segment schema.
2. Keep validation compatible with both transcript shapes: with speaker labels and without them.
3. Propagate the optional field through any shared TypeScript types used by transcript parsing and
   ingestion.
4. Add schema tests that prove both valid forms continue to parse.

**Definition of done:**

- Transcript schema validation accepts both annotated and unannotated transcript segments.
- Existing transcript fixtures still parse without changing timestamps or text.
- TypeScript builds without ad hoc casts around speaker metadata.

### Workstream 2: Transcript parsing

1. Extend `packages/praecis/youtube/src/client/transcript.ts` to detect common speaker prefixes such
   as `Name: text` and `[Speaker 1]: text`.
2. Preserve the original transcript text after parsing so attribution logic does not mutate content.
3. Treat ambiguous lines conservatively and leave the speaker field unset when the format is not
   clearly a speaker label.
4. Add parser fixtures for positive examples, ambiguous examples, and non-speaker text that should
   remain untouched.

**Definition of done:**

- Speaker labels are extracted without altering timestamps or transcript content.
- Ambiguous transcript lines do not produce false speaker attribution.
- Parser tests cover the main label patterns used by the repo’s transcript sources.

### Workstream 3: Ingestion and storage

1. Preserve the speaker value when transcript segments are stored as excerpt or segment records.
2. Make the storage path tolerant of missing speaker values so existing data remains valid.
3. Keep the stored structure stable for downstream consumers that do not care about speaker labels.
4. Add ingestion tests that verify the speaker field survives the parse-to-store round trip.

**Definition of done:**

- Ingested excerpt records keep speaker provenance when available.
- Missing speaker metadata defaults to `undefined`, not a placeholder string.
- The ingestion path remains backward compatible for transcripts without speaker labels.

### Workstream 4: Extraction payload propagation

1. Include the speaker field in the Pass 1 excerpt payload sent to the LLM.
2. Keep the field optional in the payload so existing transcripts continue to work.
3. Update extraction tests so the prompt payload assertion explicitly checks for speaker presence
   when the transcript fixture includes it.
4. Make sure downstream claim generation can attach speaker metadata when present.

**Definition of done:**

- The claim-extraction payload contains the speaker field whenever source material provides it.
- Existing extraction runs still succeed for transcripts with no speaker labels.
- Prompt payload tests fail if speaker provenance is accidentally dropped.

### Workstream 5: Fixtures, docs, and rollout

1. Add or update transcript fixtures that demonstrate both speaker-attributed and non-attributed
   behavior.
2. Keep any real-video transcript samples out of committed fixtures unless provenance is explicitly
   documented and safe to redistribute.
3. Update the relevant task docs and runbook notes so the new provenance behavior is discoverable.
4. Capture the acceptance evidence in the task ledger when the implementation lands.

**Definition of done:**

- Fixture coverage proves the parser, ingestion, and prompt payload behavior end to end.
- The docs explain how speaker attribution is preserved and how missing speaker labels are handled.
- The task ledger records the final validation commands and evidence in the same change set as the code.

## Validation Commands

- `pnpm -C packages/praecis/youtube exec vitest run tests/transcript-parse.test.ts tests/schema.test.ts tests/pipeline.test.ts tests/llm-claims.test.ts`
- `pnpm -C packages/praecis/youtube build`
- `pnpm docs:build`
- `node scripts/meminit-check.mjs docs/05-planning/tasks/task-003-extraction-quality-atomic-breakdown.md docs/05-planning/tasks/task-009-speaker-attribution.md`

## Acceptance Criteria

- Speaker attribution is represented in the transcript schema, parser, ingestion layer, and Pass 1
  prompt payload.
- The implementation does not change transcript text or timestamps while extracting speaker labels.
- The repo has tests covering both common speaker-label formats and conservative non-label cases.
- The task file can be marked complete only after the validation commands above pass and the task
  ledger records the evidence.

## Risks And Guardrails

- Do not attempt audio diarization. That is a different problem and would require a separate
  architecture.
- Prefer conservative parsing over aggressive attribution. A missing speaker value is better than a
  wrong one.
- Keep the optional field optional throughout the pipeline so legacy fixtures do not break.
- Treat any committed transcript examples as provenance-sensitive until they are explicitly known to
  be safe for redistribution.
