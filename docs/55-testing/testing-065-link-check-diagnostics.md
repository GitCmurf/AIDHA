---
document_id: AIDHA-TESTING-065
owner: Engineering
status: Draft
version: '0.1'
last_updated: 2026-10-17
title: Link Check Failure Diagnostics
type: TESTING
docops_version: '2.0'
area: DOCS
related_ids: [AIDHA-TASK-001]
---
<!-- MEMINIT_METADATA_BLOCK -->
> **Document ID:** AIDHA-TESTING-065
> **Owner:** Engineering
> **Status:** Draft
> **Version:** 0.1
> **Last Updated:** 2026-10-17
> **Type:** TESTING

# Link Check Failure Diagnostics

## Version History

| Version | Date | Author | Change Summary | Reviewers | Status | Reference |
| ------- | ---- | ------ | -------------- | --------- | ------ | --------- |
| 0.1 | 2026-10-17 | Codex | Specify stderr diagnostics for failed documentation links. | — | Draft | AIDHA-TASK-001 |

## Scope

The public-repository task links to the maintained
[CLA Assistant project documentation](https://github.com/cla-assistant/cla-assistant), which
describes the service and its GitHub integration. The hosted `cla-assistant.io` homepage returned
HTTP 503 in GitHub CI. The project documentation directly supports the statement.

The repository link checker now prints each failing URL, HTTP status, and error to stderr before
its existing summary. It continues to write the same JSON report and exit nonzero when one or more
links fail. This change does not add endpoint exceptions, alter URL checking or CLI options, or
change AIDHA's optional CLA/DCO policy.

## Acceptance and verification

- The link-checker unit test supplies one failed URL and verifies stderr identifies its URL, HTTP
  status, and error while the JSON report retains the same failure record.
- Existing unit tests continue to verify skipped statuses are non-failures and unknown statuses
  remain failures.
- Run `python3 -m unittest discover -s scripts -p 'test_linkcheck.py'` for the three offline tests.
- Run `pnpm docs:linkcheck` to exercise the complete documentation corpus against external links.
  Preserve the generated `docs/01-indices/linkcheck-report.json` outside the branch diff after
  inspection.
- Run `pnpm docs:build`.
- Run the scoped Meminit check:

  ```sh
  node scripts/meminit-check.mjs \
    docs/05-planning/tasks/task-001-public-repo.md \
    docs/55-testing/testing-065-link-check-diagnostics.md
  ```

The unit tests prove diagnostic formatting and unchanged failure/report semantics under a mocked
failed request. The full link check establishes only the current reachability observed from its
execution environment.
