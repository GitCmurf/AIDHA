---
document_id: AIDHA-GOV-003
owner: Security Team
approvers: GitCmurf
status: Draft
version: '0.4'
last_updated: 2026-10-19
title: Public Repository Security Practices
type: GOV
docops_version: '2.0'
---
<!-- MEMINIT_METADATA_BLOCK -->
> **Document ID:** AIDHA-GOV-003
> **Owner:** Security Team
> **Approvers:** GitCmurf
> **Status:** Draft
> **Version:** 0.4
> **Last Updated:** 2026-10-19
> **Type:** GOV

# Public Repository Security Practices

## Version History

| Version | Date       | Author | Change Summary                           | Reviewers | Status | Reference |
| ------- | ---------- | ------ | ---------------------------------------- | --------- | ------ | --------- |
| 0.2     | 2025-12-27 | CMF    | Seed baseline security checklist         | —         | Draft  | —         |
| 0.3     | 2025-12-27 | CMF    | Normalize metadata + add Version History | —         | Draft  | —         |
| 0.4 | 2026-10-19 | Codex | Limit scanner exceptions to exact historical findings | — | Draft | Secret Scan |

## Overview

This document serves as a **pre-flight checklist** for keeping the AIDHA repository safe to share.
It is designed to prevent accidental exposure of secrets, private drafts, and sensitive artifacts.

**Golden Rule:** If you wouldn't put it on a billboard, don't put it in a public repo.

---

## 1. The "Clean History" Principle

Git remembers everything. Deleting a file in a new commit does **not** remove it from history. If
you accidentally commit a secret or a private rant, you must rewrite history (e.g.,
`git filter-repo`) before pushing.

**Action:**

- Run `git log --stat` and scan the filenames. Do you see `temp_notes.txt` or `api_keys.json` in
  the past?
- If yes, **STOP**. Do not push. Scrub the history first.

---

## 2. Pre-Push Hygiene Checklist

### 2.1 Secrets & Credentials

- [ ] **Scan for Keys:** Run `grep -r "API_KEY" .` or use a tool like `trufflehog` or `git-secrets`.
- [ ] **Check Configs:** Ensure no real credentials are in `config.yaml` or `setup.py`. Use
  environment variables instead.
- [ ] **Verify .gitignore:** Confirm `.env`, `.venv`, and `secrets/` are ignored.

### 2.2 "Embarrassing" Artifacts

- [ ] **Chat Logs:** Raw AI transcripts (like `chat-transcript-*.txt`) are often messy and redundant.
  - *Recommendation:* Move them to a private archive or delete them. Only keep **summarized**
    insights (like `Strategic_Review.md`).
- [ ] **Drafts:** Check for files named `temp`, `draft`, `notes`, `scratch`.
  - *Recommendation:* Delete them or move them to a `WIP/` folder that is gitignored.
- [ ] **Comments:** Scan code for `TODO: fix security hole` or `Hack: remove before release`.

### 2.3 PII (Personally Identifiable Information)

- [ ] **User Data:** Ensure no real names, emails, or phone numbers are in test fixtures.
- [ ] **Internal URLs:** Check for links to private Jira tickets or internal wikis that shouldn't be
  exposed.

---

## 3. Ongoing Practices (Post-Public)

- **Atomic Commits:** Keep commits focused. Easier to revert if something goes wrong.
- **No "WIP" Commits to Main:** Use feature branches. Squash "fix typo" commits before merging.
- **Automated Scanning:** The Secret Scan workflow runs Gitleaks on pull requests, pushes to
  main/master, manual dispatch and a daily schedule. Default detection rules remain enabled.

### Historical false positives

Record a confirmed false positive as its exact commit/rule/path/line fingerprint in
`.gitleaksignore`. Do not exclude an entire file or commit: later credentials in the same file
must remain detectable. The eight entries for `c2db410d9fb535df004130475e6d9b49d7180601`
cover seven detect-secrets `hashed_secret` fields and one fixed dotenv test value. The existing
mock-key fingerprint for `97ac48a94aed1c0597085b64f9c7c95442015742` remains separate.

Gitleaks 8.24.3 uses `[allowlist]` for global allowances; the former `[[allowlists]]` tables
were ineffective in that version and have been removed. Exact fingerprints avoid broad path
exceptions when the scanner is upgraded. See the
[versioned configuration guide](https://github.com/gitleaks/gitleaks/blob/v8.24.3/README.md#configuration)
and [fingerprint guide](https://github.com/gitleaks/gitleaks/blob/v8.24.3/README.md#gitleaksignore).

To check one reviewed public revision and its ancestors with Gitleaks 8.24.3, run from the
repository root, setting `public_revision` to its full commit SHA:

```sh
gitleaks git --config .gitleaks.toml --gitleaks-ignore-path .gitleaksignore \
  --log-opts="$public_revision" --redact=100 --exit-code=2 .
```

Exit 0 means no findings; exit 2 reports findings. Before accepting an exception, reproduce
the historical findings, rerun the same history with the candidate fingerprints, and verify
that a new synthetic commit at the same paths is still detected. Keep diagnostic reports
redacted and omit secret and match values from retained evidence.

---

## 4. Incident Response

If you *do* push a secret:

1. **Rotate the secret immediately.** Consider it compromised.
2. **Rewrite history** to remove the file (if you want to clean up).
3. **Do not just delete the file** in a new commit; the secret is still in the history.
