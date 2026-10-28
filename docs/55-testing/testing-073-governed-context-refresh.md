---
document_id: AIDHA-TESTING-073
owner: Engineering
status: Draft
version: '0.3'
last_updated: 2026-10-28
title: Explicit Agent Context Refresh
type: TESTING
docops_version: '2.0'
---
<!-- MEMINIT_METADATA_BLOCK -->
> **Document ID:** AIDHA-TESTING-073
> **Owner:** Engineering
> **Status:** Draft
> **Version:** 0.3
> **Last Updated:** 2026-10-28
> **Type:** TESTING

# Explicit Agent Context Refresh

## Version History

| Version | Date | Author | Change Summary | Reviewers | Status | Reference |
| ------- | ---- | ------ | -------------- | --------- | ------ | --------- |
| 0.1 | 2026-10-18 | Codex | Specify explicit plan input, preview, bounded writes and preservation tests | — | Draft | AIDHA-PLAN-015 |
| 0.2 | 2026-10-18 | Codex | Test writer failures and reject misplaced preview flags before legacy writes | — | Draft | PR 46 review |
| 0.3 | 2026-10-28 | Codex | Clarify LF and refresh links. | Peers | Draft | PR 46 |

## Problem and scope

The post-PR40 context refresh stopped before edits because the legacy helper required
`specs/<branch>/plan.md`. AIDHA's maintained plans live under `docs/05-planning/`. The legacy
updater also rewrites dates and truncates Recent Changes bullets in existing agent files.
Reading arbitrary planning prose would introduce unsupported facts into agent instructions.

The explicit mode accepts a caller-selected plan and updates only a generated block in
`AGENTS.md`. It requires an explicit preview or write action. Existing positional invocations,
including their legacy rewriting behavior, remain available. No project-wide authoritative plan
or context values are selected by this change. Templates and stale specs are unchanged.

## Explicit source contract

The helper uses the repository's `scripts/python` interpreter selection, preferring `.venv`.
Install the repository's documentation dependencies, including PyYAML, in that interpreter.
Run from the selected checkout; relative plan paths resolve against that
checkout's root, independently of the current branch and current working directory.

```bash
bash .specify/scripts/bash/update-agent-context.sh \
    --plan docs/05-planning/plan-NNN-name.md --preview
bash .specify/scripts/bash/update-agent-context.sh \
    --plan docs/05-planning/plan-NNN-name.md --write
```

The source must resolve to a regular Markdown file inside `docs/05-planning/`, with YAML frontmatter
declaring `type: PLAN` and an `AIDHA-PLAN-NNN` document ID. Full document governance is still
checked by the existing DocOps tooling. The helper requires exactly one explicit JSON block:

```text
<!-- AIDHA_AGENT_CONTEXT_SOURCE: begin -->
{
  "version": 1,
  "language": "Python 3.12",
  "dependencies": ["stdlib"],
  "storage": [],
  "project_type": "CLI"
}
<!-- AIDHA_AGENT_CONTEXT_SOURCE: end -->
```

These are illustrative fixture values. No real planning document receives this block as part
of the repair. All five fields are mandatory; unknown or duplicate fields, other versions,
non-list dependencies/storage, blank values and multiline text are rejected. Empty lists
explicitly mean no dependencies or storage declared. Surrounding prose is never scraped.
Source symlinks resolving outside the allowed planning directory are rejected.
Explicit flags are parsed even if preceded by a legacy positional agent name; that unsupported
combination fails before any legacy write, so a misplaced `--preview` cannot be silently ignored.

## Write and preview contract

The target block uses `<!-- AIDHA_AGENT_CONTEXT: begin -->` and
`<!-- AIDHA_AGENT_CONTEXT: end -->`, each alone on its own line. If absent, the generated block
is appended with a separator. If present, only that block is replaced. Prefix and suffix bytes,
including CRLF, manual instructions, dates and any number of Recent Changes bullets, are preserved.
The generated block and separator use LF line endings; a CRLF target can therefore contain mixed
line endings while the surrounding manual bytes remain unchanged.
Duplicate, reversed, incomplete or inline delimiters fail before writing. The target must be a
regular file or absent; symlink targets are rejected. A new target is created only by `--write`.

Preview prints a unified diff and writes no files. Write computes the same content and replaces
the target atomically using a temporary file in its directory, retaining an existing file's mode.
Repeating unchanged input produces no diff or write. Temporary files are removed after failure.
This is a single-writer operation: pause concurrent manual editing while applying it. A final
state/byte comparison detects changes before replacement, but does not provide a compare-and-swap
guarantee against an editor changing the file between that comparison and rename.

## Acceptance and verification

The process-level suite is
[`scripts/test_update_agent_context.py`](https://github.com/GitCmurf/AIDHA/blob/3179a8cbcf63a10214a057f958a17cf7aaa167fb/scripts/test_update_agent_context.py).
Each test copies the real helper into a disposable Git repository. It never invokes the updater
against this repository's actual agent instructions. The initial acceptance failed with the real
missing legacy `specs/main/plan.md` error before implementation.

- Preview, explicit write and repeat write preserve manual bytes and the third Recent Changes item.
- Replacement preserves the exact prefix/suffix, CRLF and file mode. An old access time does not
  cause a false concurrent-edit failure; filesystem timestamps are not preserved.
- Preview of a file without a terminal newline produces a valid unified diff.
- Invalid source schemas/delimiters, malformed target markers, path escapes, symlink targets,
  nonregular targets and ambiguous/missing actions fail without altering manual content.
- A missing target stays absent during preview and is created only by explicit write.
- A legacy positional `codex` invocation still reads a legacy spec in its isolated fixture.
- A positional `codex` followed by explicit preview flags fails without writing, even when a
  valid legacy spec exists.
- Explicit mode selects the existing project Python environment when available.
- A nonregular source, including a FIFO, fails before reading rather than hanging.
- An edit injected when the prepared file is flushed survives rejection by the final change check;
  the generated temporary file is removed. A failed atomic replacement preserves the caller's
  original bytes and also removes the temporary file.

The two writer-failure tests call the real helper entrypoint in a child process with controlled
OS-boundary fault injection. Counterfactual runs in separate disposable copies remove the final
change guard or the cleanup guard respectively; each corresponding regression test fails. These
controls establish that the assertions detect lost concurrent edits and leaked temporary files.

```bash
bash -n .specify/scripts/bash/update-agent-context.sh
shellcheck --severity=warning .specify/scripts/bash/update-agent-context.sh
python3 scripts/test_update_agent_context.py
node scripts/meminit-check.mjs docs/55-testing/testing-073-governed-context-refresh.md
pnpm docs:build
```

CI runs the suite after installing documentation dependencies. The existing shell-lint job checks
the helper at warning severity, alongside its ordinary script checks. Remaining legacy info/style
observations are outside that gate; no warning-level exclusions are added.

## Refreshed verification on 2026-10-28

Against main `0fd1ae3979b8c05222929ef2b113ff1f8caaacf5`, all 16 process-level tests pass,
alongside Bash syntax and warning-level ShellCheck. These checks use disposable repositories; the
real agent instructions and real planning inputs remain unchanged.

## Remaining owner choices

Choose the authoritative plan and approve its actual context values before a project-wide refresh.
Automatic refresh defaults and migrating legacy callers require separate scope. This opt-in
engineering repair neither makes those choices nor changes product/model behavior.
