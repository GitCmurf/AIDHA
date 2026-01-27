---
document_id: AIDHA-GOV-003
owner: Security Team
approvers: GitCmurf
status: Draft
version: '0.3'
last_updated: 2025-12-27
title: Public Repository Security Practices
type: GOV
docops_version: '2.0'
---
<!-- MEMINIT_METADATA_BLOCK -->
> **Document ID:** AIDHA-GOV-003
> **Owner:** Security Team
> **Approvers:** GitCmurf
> **Status:** Draft
> **Version:** 0.3
> **Last Updated:** 2025-12-27
> **Type:** GOV

# Public Repository Security Practices

## Version History

| Version | Date       | Author | Change Summary                           | Reviewers | Status | Reference |
| ------- | ---------- | ------ | ---------------------------------------- | --------- | ------ | --------- |
| 0.2     | 2025-12-27 | CMF    | Seed baseline security checklist         | —         | Draft  | —         |
| 0.3     | 2025-12-27 | CMF    | Normalize metadata + add Version History | —         | Draft  | —         |

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
- **Automated Scanning:** Eventually, add a GitHub Action to scan for secrets on every PR.

---

## 4. Incident Response

If you *do* push a secret:

1. **Rotate the secret immediately.** Consider it compromised.
2. **Rewrite history** to remove the file (if you want to clean up).
3. **Do not just delete the file** in a new commit; the secret is still in the history.
