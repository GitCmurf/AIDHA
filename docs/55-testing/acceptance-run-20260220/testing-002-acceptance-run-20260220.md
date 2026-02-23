---
document_id: AIDHA-TESTING-002
owner: Repo Maintainers
status: Draft
version: '0.1'
last_updated: 2026-02-20
title: Acceptance Run 20260220
type: TESTING
docops_version: '2.0'
---

<!-- MEMINIT_METADATA_BLOCK -->
> **Document ID:** AIDHA-TESTING-002
> **Owner:** Repo Maintainers
> **Approvers:** —
> **Status:** Draft
> **Version:** 0.1
> **Last Updated:** 2026-02-20
> **Type:** TESTING

# Acceptance Run 20260220

## Version History

| Version | Date       | Author | Change Summary                                           | Reviewers | Status | Reference |
| ------- | ---------- | ------ | -------------------------------------------------------- | --------- | ------ | --------- |
| 0.1     | 2026-02-20 | AI     | Add final acceptance capture for heuristic + LLM-backed lanes. | — | Draft | — |

## Scope

Final end-to-end acceptance artifact capture for MVP delivery lane with:

- Heuristic extraction lane (CLI path, mock YouTube ingest).
- LLM-backed extraction lane (offline deterministic mock `LlmClient` path).
- Determinism rerun checks for exported dossier/transcript artifacts.
- Release readiness evidence commands for backend contract and golden fixtures.
- DocOps build gate evidence (`pnpm docs:build`).

## Environment Snapshot

- `git rev-parse HEAD`: `8ddd458f6f609d1a1abc850d50577e951786b3d4`
- `node --version`: `v22.21.1`
- `pnpm --version`: `9.12.0`
- `yt-dlp --version`: `2026.02.04`

## Commands and Logs

All command transcripts are captured at:

- `docs/55-testing/acceptance-run-20260220/logs/commands.log`

Acceptance runner script:

- `scripts/acceptance/run-acceptance-20260220.sh`

LLM offline acceptance helper:

- `scripts/acceptance/llm-offline-acceptance.mjs`

## Acceptance Criteria Results

1. Ingest -> extract -> refs -> export -> query flow: **PASS** (heuristic lane).
2. LLM-backed extraction lane: **PASS** (offline deterministic mock LLM path).
3. Deterministic rerun behavior for unchanged input: **PASS**.
4. Backend parity evidence (`reconditum` contract suite): **PASS**.
5. Golden fixture invariants (`praecis/youtube`): **PASS**.
6. Docs build gate: **PASS**.

## Artifacts

Generated artifacts:

- `docs/55-testing/acceptance-run-20260220/artifacts/dossier-test-video-heuristic.txt`
- `docs/55-testing/acceptance-run-20260220/artifacts/dossier-test-video-heuristic.draft.txt`
- `docs/55-testing/acceptance-run-20260220/artifacts/dossier-test-video-heuristic-rerun.txt`
- `docs/55-testing/acceptance-run-20260220/artifacts/dossier-test-video-heuristic-rerun.draft.txt`
- `docs/55-testing/acceptance-run-20260220/artifacts/transcript-test-video-heuristic.json`
- `docs/55-testing/acceptance-run-20260220/artifacts/transcript-test-video-heuristic-rerun.json`
- `docs/55-testing/acceptance-run-20260220/artifacts/dossier-test-video-llm.txt`
- `docs/55-testing/acceptance-run-20260220/artifacts/transcript-test-video-llm.json`
- `docs/55-testing/acceptance-run-20260220/artifacts/llm-acceptance-summary.json`
- `docs/55-testing/acceptance-run-20260220/artifacts/sha256.txt`

## Determinism Evidence

Checksums from `sha256.txt`:

- `dossier-test-video-heuristic.txt` == `dossier-test-video-heuristic-rerun.txt`
- `dossier-test-video-heuristic.draft.txt` == `dossier-test-video-heuristic-rerun.draft.txt`
- `transcript-test-video-heuristic.json` == `transcript-test-video-heuristic-rerun.json`

This confirms deterministic exports for unchanged inputs in the heuristic lane.

## Notes and Constraints

- The environment prohibits binding local TCP listener ports (`listen EPERM`), so the
  LLM-backed acceptance lane uses an in-process deterministic mock `LlmClient` rather than
  an HTTP mock server.
- This acceptance run is intentionally offline/local-first and does not require network
  calls or external API secrets.

## Engineering Principles Alignment

- **Atomic unit of work:** scripts + acceptance execution evidence + docs are included together.
- **Deterministic testing:** rerun checks and checksum evidence are captured.
- **Failure-first and explicitness:** environmental constraint is recorded explicitly, with
  fallback approach documented.
- **DocOps discipline:** governed testing document with metadata and version history included.
