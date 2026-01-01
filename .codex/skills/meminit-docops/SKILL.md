---
name: meminit-docops
description: Use when asked to retrofit Meminit into a repo or enforce DocOps (scan/check/fix/index), with safety-first defaults.
metadata:
  short-description: Meminit migration + compliance playbook (scan → config → check → fix → index).
---

# Meminit DocOps Skill (Codex)

## Purpose
This skill teaches Codex *how* to use `meminit` to:
- retrofit Meminit into an existing repository (brownfield migration), and
- keep documentation compliant over time (local + CI gates).

It does **not** decide *when* your repo should adopt DocOps; that policy belongs in `AGENTS.md` and CI settings.

## Safety rules (non-negotiable)
1. Prefer read-only commands first: `scan`, `doctor`, `check`.
2. Never run a write operation (`fix --no-dry-run`, or any rename) without:
   - showing a dry-run preview, and
   - explicit user confirmation.
3. Never attempt to “fix” semantic governance manually (ownership, approvals, status promotion) without asking.
4. Do not introduce fake markdown links like `[text](path)` unless the target exists.

## Quick command map
- Repo readiness: `meminit doctor --root .`
- Compliance: `meminit check --root .` (use `--format json` for pipelines)
- Safe preview: `meminit fix --root . --dry-run`
- Apply mechanical fixes: `meminit fix --root . --no-dry-run`
- Migration planning: `meminit scan --root . --format json`
- Index + resolution:
  - `meminit index --root .`
  - `meminit resolve <DOCUMENT_ID> --root .`
  - `meminit identify <PATH> --root .`
  - `meminit link <DOCUMENT_ID> --root .`

## Decision tree (brownfield migration)

### Step 0 — Confirm boundaries
Ask:
- Is everything under `docs/` governed, or do we exclude WIP drafts?
- What is the repo prefix (e.g., `ARCHITEXT`), and should new IDs follow `REPO-TYPE-SEQ`?

If WIP drafts exist:
- Recommend using `WIP-` prefix and/or `excluded_filename_prefixes` so WIP docs don’t break `meminit check`.

### Step 1 — Scan (read-only)
Run:
```bash
meminit scan --root . --format json
```
Interpret:
- `suggested_type_directories` → propose `docops.config.yaml` overrides.
- `ambiguous_types` → ask the user to pick the intended mapping (do not guess).

### Step 2 — Align `docops.config.yaml` to reality
Edit config only after user agrees. Typical edits:
- `docs_root`
- `schema_path`
- `type_directories`
- `excluded_paths` / `excluded_filename_prefixes`

### Step 3 — Doctor (repo-level readiness)
Run:
```bash
meminit doctor --root .
```
If doctor reports schema missing/invalid, fix that before continuing.

### Step 4 — Check (authoritative violations)
Run:
```bash
meminit check --root .
```
Do not apply fixes yet; first categorize:
- Mechanical: filenames, missing frontmatter, date normalization.
- Manual: duplicate IDs, missing ownership, status promotion/approval.

### Step 5 — Fix (dry-run, then apply)
Run:
```bash
meminit fix --root . --dry-run
```
Show the user the proposed actions. If approved:
```bash
meminit fix --root . --no-dry-run
```

### Step 6 — Re-check until green
Run:
```bash
meminit check --root .
```
If still failing, enumerate remaining violations and identify which are manual.

### Step 7 — Index (optional but recommended)
Once green (or close), build the index:
```bash
meminit index --root .
```
Use `resolve/identify/link` for stable references in docs and tooling.

## Decision tree (ongoing enforcement)
- Local:
  - `meminit install-precommit --root .`
  - Encourage “fix locally” before PR.
- CI:
  - Run `meminit doctor` and `meminit check` on PRs only.
  - Use least privilege (workflow `permissions: read-all`).
  - Avoid secrets in DocOps workflows.

## References (in this repo)
- Brownfield migration runbook: `docs/60-runbooks/runbook-005-brownfield-repo-migration.md`
- CI/CD enforcement runbook: `docs/60-runbooks/runbook-004-ci-cd-enforcement.md`
