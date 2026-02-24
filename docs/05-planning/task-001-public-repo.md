---
document_id: AIDHA-TASK-001
owner: GitCmurf
status: Draft
version: "1.3"
last_updated: 2026-02-23
title: Public Repository Readiness — Task List & Strategy
type: TASK
docops_version: "2.0"
---

<!-- MEMINIT_METADATA_BLOCK -->

> **Document ID:** AIDHA-TASK-001
> **Owner:** GitCmurf
> **Status:** Active
> **Version:** 1.3
> **Last Updated:** 2026-02-23
> **Type:** TASK

# Public Repository Readiness — Task List & Strategy

## Version History

| Version | Date       | Author | Change Summary | Reviewers | Status | Reference |
| ------- | ---------- | ------ | -------------- | --------- | ------ | --------- |
| 1.0     | 2026-02-23 | AI     | Initial release of public-repo readiness task plan. | — | Active | — |
| 1.1     | 2026-02-23 | AI     | Updated task sections and checklist wording for license/security/docs planning details. | — | Active | — |
| 1.2     | 2026-02-23 | AI     | Clarified security reporting guidance alignment, normalized status markers, and corrected version-history semantics. | — | Active | — |
| 1.3     | 2026-02-23 | AI     | Updated checklist states to reflect actual repo findings (telemetry-id still tracked, package-lock.json files present, added env var documentation task). | — | Active | — |

## Project Status

Execution status is tracked in checklist sections below.
Version History records document revisions only.

---

## Part 1 — Steps to "Safely" Go Public

This section covers both **security** (no leaked secrets, PII, or attack surface) and **commercial
protection** (retaining your rights while sharing code). Items are ordered by criticality.

### 1.1 Git History Sanitisation

> **Status:** 🟡 Needs Verification

The Feb 2026 audit (AIDHA-GOV-003, prior conversation) confirmed the **current HEAD** is clean.
However, git history may contain previously-committed secrets, debug files, or personal notes that
were later deleted.

- [ ] Run `trufflehog git file://. --since-commit=$(git rev-list --max-parents=0 HEAD)` on the full
      history
- [ ] Run `git log --all --diff-filter=D --name-only` to list every file ever deleted — review the
      list for `.env`, `*.key`, personal docs, etc.
- [ ] **Decision point — fresh history or scrubbed history:**
  - _Option A (recommended for pre-alpha):_ Squash the entire private history into a single
    "initial commit" and start the public repo with a clean slate. This is the simplest and safest
    approach for a project at this stage.
  - _Option B:_ Use `git filter-repo` or `BFG Repo-Cleaner` to surgically remove any sensitive
    blobs while preserving history.
- [ ] After either option, verify with `trufflehog` again

### 1.2 Secrets & Credentials Audit (Current State)

> **Status:** 🟡 In Progress (verified Feb 2026, follow-up checks pending)

- [x] `.gitignore` covers `.env`, `.env.*`, `secrets/`, `credentials/`, `*.key`, `*.secret`
- [x] No hardcoded API keys, tokens, or passwords found in tracked source files
- [x] `YOUTUBE_COOKIE` correctly sourced from environment variable, not committed
- [x] Add `detect-secrets` hook to `.pre-commit-config.yaml` for ongoing prevention
- [x] Confirm `firebase-debug.log` (contains personal email) remains untracked — DELETED
- [ ] `telemetry-id` added to `.gitignore` but file is still tracked — run `git rm --cached telemetry-id`

### 1.3 PII & Embarrassment Review

> **Status:** ✅ Clean (verified Feb 2026)

- [x] No profanity, aggressive comments, or embarrassing TODOs found
- [x] `coderabbit-review-*.txt` files are gitignored
- [x] `WIP-*` files are gitignored
- [ ] Verify that `specs/` feedback files (`v1.2-feedback-AC.md`, etc.) don't contain sensitive
      reviewer information or proprietary third-party content
- [ ] Review `docs/55-testing/acceptance-run-*` artifacts for any PII in test transcripts

### 1.4 License File

> **Status:** ✅ Completed

The current `LICENSE.md` now contains the full Apache 2.0 license text.

- [x] Replace `LICENSE.md` with the full Apache License 2.0 text (see Part 2 below)
- [x] Add `"license": "Apache-2.0"` to the root `package.json`
- [x] Add `"license": "Apache-2.0"` and `"author"` field to each package's `package.json`:
  - `packages/aidha-config/package.json`
  - `packages/phyla/package.json`
  - `packages/reconditum/package.json`
  - `packages/praecis/youtube/package.json`
- [ ] Add SPDX license header to every source file (see Part 2 for template)
- [x] Decide whether the `private: true` flag should remain (yes, while it's a monorepo root —
      prevents accidental npm publish)

### 1.5 Copyright & Attribution

- [x] Add a `NOTICE` file (Apache 2.0 convention) at the repo root — see Part 2
- [ ] Ensure `gov-005-third-party-notices.md` is complete for all vendored or fixture data
- [ ] Verify YouTube golden test fixtures comply with their source license terms (currently noted as
      "Creative Commons — verify before redistribution")
- [ ] Remove or rewrite any content authored by others without license (e.g. check `specs/`
      feedback files)

### 1.6 README & Public-Facing Documentation

> **Status:** ✅ Completed

- [x] Ensure `README.md` includes:
  - [x] Project description and value proposition
  - [x] License badge (`[![License](https://img.shields.io/badge/License-Apache_2.0-blue.svg)]...`)
  - [x] Installation and quick-start instructions
  - [x] Link to `CONTRIBUTING.md`
  - [x] Link to `CODE_OF_CONDUCT.md`
- [x] Create `CONTRIBUTING.md` (contributor guide: code style, PR process, CLA/DCO)
- [x] Create `CODE_OF_CONDUCT.md` (adopt Contributor Covenant or similar)
- [x] Create or update `SECURITY.md` (vulnerability reporting process)
- [ ] Document required environment variables in package READMEs or a dedicated ENVIRONMENT.md:
  - [ ] `AIDHA_LLM_API_KEY` — LLM API key for extraction
  - [ ] `YOUTUBE_COOKIE` — YouTube authentication cookie
  - [ ] `YOUTUBE_INNERTUBE_API_KEY` — YouTube InnerTube API key
  - [ ] Document the `${VAR}` interpolation pattern for contributors

### 1.7 CI/CD & GitHub Repository Settings

- [ ] Review `.github/workflows/docs-check.yml` — ensure it doesn't expose secrets in logs
- [ ] Add branch protection rules (require PR reviews, passing CI before merge)
- [ ] Configure GitHub repository settings:
  - [ ] Enable Dependabot for security alerts
  - [ ] Enable secret scanning (GitHub Advanced Security)
  - [ ] Set default branch to `main`
  - [ ] Consider enabling GitHub Discussions for community engagement

### 1.8 Dependency Licence Audit

- [ ] Run `npx license-checker --summary` on each package to verify all transitive dependencies are
      compatible with Apache 2.0
- [ ] Flag any GPL-licensed dependencies (Apache 2.0 is incompatible with GPLv2; compatible with
      GPLv3 **only** in one direction)
- [ ] Document findings in `gov-005-third-party-notices.md`

### 1.9 Cleanup & Housekeeping

> **Status:** 🟡 Needs Attention — several tracked-but-gitignored files remain

- [ ] Remove `coderabbit-review-*.txt` files from the working tree (3 files present, gitignored)
- [x] Remove `firebase-debug.log` from working tree — DELETED
- [ ] Review whether `specs/` directory belongs in the public repo or should be archived/removed
- [ ] Remove tracked `package-lock.json` files (repo uses pnpm; found in root and 3 package locations)
- [ ] Run `git rm --cached telemetry-id` — file is in .gitignore but still tracked
- [ ] Remove the `out/` directory if it's committed build output
- [ ] Verify `node_modules/` is not tracked (it shouldn't be, but confirm)

---

## Part 2 — Apache 2.0 Licence Analysis

### 2.1 Why Apache 2.0 Is a Good Fit

Apache 2.0 is **well-suited** for AIDHA. There are **no significant contra-indications**:

| Factor                     | Apache 2.0 Assessment                                                                           |
| -------------------------- | ----------------------------------------------------------------------------------------------- |
| **Patent grant**           | ✅ Includes an express patent licence — protects contributors and users                         |
| **Commercial use**         | ✅ Explicitly permits commercial use, modification, distribution                                |
| **Compatibility**          | ✅ Compatible with MIT, BSD, and GPLv3; widely accepted by enterprises                          |
| **Contributor protection** | ✅ Patent retaliation clause deters patent trolling against the project                         |
| **Trademark**              | ✅ Does NOT grant trademark rights — you retain full control over the "AIDHA" name              |
| **Attribution**            | ✅ Requires attribution in derivative works (via NOTICE file)                                   |
| **Copyleft**               | ❌ Apache 2.0 is **permissive**, not copyleft — others can relicense derivatives as proprietary |

#### Potential Concerns (and Why They're Manageable)

1. **Permissive = someone can fork and close-source it.** This is true of all permissive licenses
   (MIT, BSD, Apache). Mitigations: (a) your NOTICE/copyright persists, (b) trademark protection
   keeps your brand, (c) the "open core" model in Part 3 keeps your most valuable differentiators
   proprietary.

2. **GPLv2 incompatibility.** Apache 2.0 cannot be combined with GPLv2-only code. This is unlikely
   to matter for AIDHA (your dependency stack is MIT/BSD/ISC), but check with the licence audit in
   §1.8.

3. **No "network copyleft" (unlike AGPL).** If someone runs a modified AIDHA as a web service,
   they don't have to share their changes. If SaaS protection matters, consider AGPL for the core
   — but this significantly reduces enterprise adoption. **Recommendation: stick with Apache 2.0
   and protect commercial interests via the open-core model instead.**

### 2.2 Maximising Visibility & Credit as Author/Copyright-Owner/Architect

Apache 2.0 **already** provides strong attribution requirements. Here's how to maximise them:

#### A. The `NOTICE` File (Legally Required to Be Preserved)

Create `NOTICE` at the repo root. Under Apache 2.0, **anyone who redistributes the code MUST
include the contents of this file.** This is your most powerful attribution mechanism.

```text
AIDHA — AI-Assisted Personal Cognition Graph Manager
Copyright 2025-2026 Colin Farmer (GitCmurf)

This product includes software developed by Colin Farmer.

For more information, see https://github.com/GitCmurf/AIDHA
```

#### B. SPDX Headers in Every Source File

Add this header to every `.ts` file:

```typescript
// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 Colin Farmer (GitCmurf)
```

And in Markdown/YAML files where appropriate:

```markdown
<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- Copyright 2025-2026 Colin Farmer (GitCmurf) -->
```

These headers serve as per-file attribution that survives copy-paste and partial redistribution.

#### C. `package.json` Author Fields

Add to each `package.json`:

```json
{
  "author": "Colin Farmer <colinfarmer.gg1@gmail.com> (https://github.com/GitCmurf)",
  "license": "Apache-2.0",
  "repository": {
    "type": "git",
    "url": "https://github.com/GitCmurf/AIDHA.git"
  }
}
```

#### D. GitHub Profile & README Prominence

- Use GitHub's "About" section to describe AIDHA
- Pin the AIDHA repo on your GitHub profile
- Include "Created by [Colin Farmer](https://github.com/GitCmurf)" prominently in the README
- Add a `CITATION.cff` file for academic-style citation

#### E. Optional: Contributor Licence Agreement (CLA)

If you want to retain the ability to later relicense AIDHA (e.g. for a commercial edition), require
contributors to sign a CLA that assigns copyright or grants you a broad licence. Tools like
[CLA Assistant](https://cla-assistant.io/) automate this via GitHub. This is standard practice for
Apache-licensed projects (the ASF itself requires CLAs).

> [!IMPORTANT]
> **Without a CLA, each contributor retains copyright on their contributions**, and you cannot
> unilaterally relicense the project. If dual-licensing or open-core commercialization is in your
> plans (see Part 3), a CLA is strongly recommended from day one.

---

## Part 3 — Commercialisation Opportunities & Repo Structure

### 3.1 Viable Commercial Models

Given AIDHA's architecture (ingestion → taxonomy → graph database → export), several proven
open-source commercialisation models apply. They are listed in order of how well they fit the
current codebase:

#### Model 1: Open Core (⭐ Recommended)

**Open source the engine; commercialise the experience.**

| Layer                      | Licence                                                                              | What's Included                                                                                                                  |
| -------------------------- | ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| **Open core** (Apache 2.0) | Engine: ingestion pipeline, taxonomy classifiers, graph backend, CLI, JSON-LD export | Code people can self-host                                                                                                        |
| **Proprietary layer**      | Commercial                                                                           | Web/desktop UI, managed hosting, premium LLM prompt packs, curated taxonomies, team collaboration, SSO/RBAC, analytics dashboard |

**Why this works for AIDHA:**

- The open core (packages `reconditum`, `phyla`, `praecis`) is the "engine" — technically
  interesting but requires significant effort to productise
- The proprietary layer is where user value concentrates: making the engine **usable**
- Contributors improve the engine (your moat deepens); competitors build on your platform
  (ecosystem effect)

#### Model 2: Managed Service / SaaS

**Open source everything; charge for hosting and operations.**

- Users can self-host for free (Apache 2.0 allows this)
- You offer a hosted version with SLAs, automatic updates, backups, and integrations
- Think: GitLab (open-core + SaaS), Supabase, PostHog

**Why it could work:** Personal knowledge management as a service avoids the user running a graph
database locally. But this requires significant investment in multi-tenancy, auth, billing.

#### Model 3: Professional Services / Consulting

- Open source everything
- Revenue comes from customisation, integration, and training for organisations
- Lower margin, doesn't scale as well, but near-zero investment to start

#### Model 4: Dual Licensing

- Offer the codebase under Apache 2.0 for open-source/community use
- Offer a separate commercial licence for enterprises that want to embed AIDHA in proprietary
  products without Apache 2.0 attribution requirements
- **Requires CLA** to be feasible (you must own all the copyright)
- Less common for developer tools; more common for libraries/databases

### 3.2 Recommended Repo Structure for Open Core

The current monorepo is already well-structured for an open-core split. Here's the recommended
evolution:

```text
GitCmurf/aidha                    ← PUBLIC (Apache 2.0)
├── packages/
│   ├── aidha-config/             ← Shared config schema & resolution
│   ├── reconditum/               ← Graph backend engine
│   ├── phyla/                    ← Taxonomy & classification
│   └── praecis/
│       └── youtube/              ← YouTube ingestion pipeline
│       └── web/                  ← (future) Web page ingestion
│       └── pdf/                  ← (future) PDF ingestion
├── docs/                         ← Public documentation (DocOps)
├── testdata/                     ← Golden test fixtures
└── ...

GitCmurf/aidha-pro                ← PRIVATE (Proprietary)
├── packages/
│   ├── aidha-ui/                 ← Web/desktop UI
│   ├── aidha-auth/               ← Authentication & team management
│   ├── aidha-analytics/          ← Usage analytics & insights
│   └── aidha-prompts-premium/    ← Curated LLM prompt packs
├── config/
│   ├── templates/                ← Opinionated workflow templates
│   └── taxonomies/               ← Premium taxonomy packs
├── infra/                        ← Deployment (Docker, Terraform, etc.)
└── docs/                         ← Private documentation
```

#### Key Structuring Principles

1. **The open repo must be fully functional.** It should work end-to-end via CLI without the
   proprietary layer. This is critical for community adoption and trust.

2. **Clean dependency direction.** The proprietary repo depends on the open repo, never the
   reverse. Use workspace protocol references (`workspace:*`) or published npm packages.

3. **Configuration is the boundary.** `aidha-config` defines the schema; the open repo provides
   sensible defaults; the proprietary layer provides curated/premium configurations.

4. **LLM prompts as a product.** Currently the `prompts/` directories are stubs. When they mature:
   - Keep basic/reference prompts in the open repo (community benefit)
   - Offer optimised, domain-specific prompt packs as premium content

5. **User data never enters either repo.** Data lives in `~/.aidha/` or a managed service
   database. Both repos are code-only.

### 3.3 What to Keep Open vs. Proprietary

| Component                               | Open (Apache 2.0) | Proprietary |
| --------------------------------------- | ----------------- | ----------- |
| Ingestion pipelines (YouTube, PDF, web) | ✅                | —           |
| Taxonomy engine & base schemas          | ✅                | —           |
| Graph backend (reconditum)              | ✅                | —           |
| Configuration schema & resolution       | ✅                | —           |
| CLI interface                           | ✅                | —           |
| JSON-LD / dossier export                | ✅                | —           |
| Basic LLM prompts (reference)           | ✅                | —           |
| Engineering docs, ADRs, governance      | ✅                | —           |
| Web/mobile UI                           | —                 | ✅          |
| Team collaboration & RBAC               | —                 | ✅          |
| Premium prompt packs                    | —                 | ✅          |
| Curated taxonomy templates              | —                 | ✅          |
| Managed hosting / SaaS infra            | —                 | ✅          |
| Analytics & usage insights              | —                 | ✅          |
| Enterprise SSO integration              | —                 | ✅          |
| Priority support & SLAs                 | —                 | ✅          |

### 3.4 When to Split the Repos

**Not yet.** At the pre-alpha stage, the overhead of managing two repos outweighs the benefits.

**Recommended timeline:**

1. **Now:** Go public with the monorepo. Add Apache 2.0. Set up CLA.
2. **When the first proprietary component is built** (likely the UI): Create `aidha-pro` as a
   separate private repo that depends on the public package.
3. **When packages are stable enough to publish:** Consider publishing `@aidha/graph-backend`,
   `@aidha/taxonomy`, etc. to npm (still Apache 2.0). This lets the proprietary repo consume them
   as regular dependencies instead of `file:` references.

### 3.5 Protecting the "AIDHA" Brand

Apache 2.0 does **not** grant trademark rights. To formally protect the name:

- [ ] Consider trademark registration for "AIDHA" (starts ~$250 USD for a US filing)
- [ ] Add a `TRADEMARKS.md` file stating that "AIDHA" is a trademark of Colin Farmer and may not
      be used to endorse derivative products
- [ ] Include trademark guidance in `CONTRIBUTING.md`

---

## Summary Checklist

### Must Do Before Going Public

- [ ] Sanitise or squash git history (§1.1)
- [x] Replace `LICENSE.md` with Apache License 2.0 (§1.4)
- [x] Create `NOTICE` file (§2.2A)
- [x] Add `license` + `author` fields to all `package.json` files (§1.4, §2.2C)
- [x] Create `CONTRIBUTING.md` (§1.6)
- [x] Create `CODE_OF_CONDUCT.md` (§1.6)

### Strongly Recommended

- [ ] Add SPDX headers to source files (§2.2B)
- [x] Add `detect-secrets` pre-commit hook (§1.2)
- [ ] Run dependency licence audit (§1.8)
- [ ] Set up CLA for contributors (§2.2E)
- [x] Create `SECURITY.md` (§1.6)
- [ ] Clean up tracked-but-gitignored files:
      `coderabbit-review-*.txt`, `package-lock.json`, `telemetry-id` (§1.9)
- [ ] Document required environment variables (§1.6)
- [ ] Verify `specs/` feedback files for third-party content (§1.3)

### Nice to Have (Can Follow Shortly After)

- [x] Add licence badge to README (§1.6)
- [ ] Create `CITATION.cff` (§2.2D)
- [ ] Enable Dependabot and secret scanning (§1.7)
- [ ] Add `TRADEMARKS.md` (§3.5)
- [ ] Set up branch protection rules (§1.7)

## Feedback on adoption

What Will Actually Prevent Adoption

  Issue: No "Hello World"
  Why It Matters: People need to see value in <5 minutes
  Current State: CLI requires manual build, no demo
  ────────────────────────────────────────
  Issue: Architectural opacity
  Why It Matters: "What does this DO?" isn't answerable from README
  Current State: README describes components, not workflow
  ────────────────────────────────────────
  Issue: Installation friction
  Why It Matters: pnpm install && pnpm -C packages/x build × 4 packages
  Current State: High barrier for casual evaluation
  ────────────────────────────────────────
  Issue: Output mystery
  Why It Matters: No examples of what the graph actually looks like
  Current State: Test fixtures exist but not showcased

  What I'd Do Before Going Public

  1. Create a 5-minute "See It Work" path
    - One command that works: npx @aidha/youtube ingest <url>
    - Or better: publish packages to npm so npm install -g @aidha/youtube works
  2. Add a "What is AIDHA?" section at the top of README
  AIDHA turns video content into a queryable knowledge graph.

  Watch a video → AIDHA extracts claims → You refine them → Export as JSON-LD

  Unlike note-taking apps, AIDHA tracks provenance: every claim links to its source timestamp.
  3. Show, don't just tell
    - Add examples/output/ with sample JSON-LD
    - One screenshot of the CLI in action
    - One graph visualization (even if crude)
  4. Simplify the contribution path
    - The DocOps system is impressive but adds cognitive load
    - Add a CONTRIBUTING_QUICK.md with the 80/20 path

  ---

### The Only Thing That Matters Right Now

  Can someone run `npx @aidha/youtube https://youtube.com/watch?v=xyz` and see something cool in 2 minutes?

  If the answer is "no," fix that first. Everything else is distraction.

  The technical foundation is excellent. But notice what the tests don't cover:

- CLI user experience
- Installation/onboarding
- Output visualization
- End-to-end workflow demo
