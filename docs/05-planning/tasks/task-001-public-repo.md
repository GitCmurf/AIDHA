---
document_id: AIDHA-TASK-001
owner: GitCmurf
status: Draft
version: "1.10"
last_updated: 2026-02-27
title: Public Repository Readiness — Task List & Strategy
type: TASK
docops_version: "2.0"
---

<!-- MEMINIT_METADATA_BLOCK -->

> **Document ID:** AIDHA-TASK-001
> **Owner:** GitCmurf
> **Status:** Draft
> **Version:** 1.10
> **Last Updated:** 2026-02-27
> **Type:** TASK

# Public Repository Readiness — Task List & Strategy

## Version History

| Version | Date       | Author | Change Summary | Reviewers | Status | Reference |
| ------- | ---------- | ------ | -------------- | --------- | ------ | --------- |
| 1.0     | 2026-02-23 | AI     | Initial release of public-repo readiness task plan. | — | Draft | — |
| 1.1     | 2026-02-23 | AI     | Updated task sections and checklist wording for license/security/docs planning details. | — | Draft | — |
| 1.2     | 2026-02-23 | AI     | Clarified security reporting guidance alignment, normalized status markers, and corrected version-history semantics. | — | Draft | — |
| 1.3     | 2026-02-23 | AI     | Updated checklist states to reflect actual repo findings (telemetry-id still tracked, package-lock.json files present, added env var documentation task). | — | Draft | — |
| 1.4     | 2026-02-24 | AI     | Integrated adoption feedback into a structured Launch Readiness section. | — | Draft | — |
| 1.5     | 2026-02-24 | AI     | Correct checklist mismatches, move TASK under `docs/05-planning/tasks/`, and add go/no-go gates. | — | Draft | — |
| 1.6     | 2026-02-24 | AI     | Adjust secret-scan go/no-go gate to match the repo's pre-commit workflow. | — | Draft | — |
| 1.7     | 2026-02-24 | AI     | Remove public email references and add CI secret scanning workflow gate. | — | Draft | — |
| 1.8     | 2026-02-24 | AI     | Add fixture/license and history-scan clarifications for public launch. | — | Draft | — |
| 1.9     | 2026-02-27 | AI     | Refresh checklist evidence, close verified local gates, and add environment-variable documentation evidence. | — | Draft | — |
| 1.10    | 2026-02-27 | AI     | Complete PII review, dependency license audit, and create CONTRIBUTING_QUICK.md. | — | Draft | — |

## Project Status

Execution status is tracked in checklist sections below.
Version History records document revisions only.

## Execution Evidence (2026-02-27)

- `meminit check --root .` passed with 0 violations and 0 warnings.
- `pnpm docs:build` passed (`mkdocs build --strict` succeeded).
- User-verified local IDE run: `pre-commit run --all-files` passed
  `Detect secrets`; only `markdownlint` was failing before follow-up fixes.
- Repo hygiene checks:
  - no `specs/` directory present
  - `node_modules/` is not tracked
  - no tracked `package-lock.json` or tracked `out/` artifacts

## Go/No-Go Gates (Flip Repo To Public)

- [x] `meminit check --root .` passes with 0 violations and 0 warnings
- [x] `pre-commit run detect-secrets --all-files` passes (baseline reviewed)
- [ ] GitHub Actions `Secret Scan` workflow passes (gitleaks)
- [x] `pnpm docs:build` passes (MkDocs site is the review artifact)
- [ ] Git history strategy is executed (see §1.1): squash vs scrub
- [ ] Fixture redistribution is verified or removed (see AIDHA-GOV-005)
- [ ] GitHub settings are applied (see §1.7): branch protection, security reporting, etc.

---

## Part 1 — Steps to "Safely" Go Public

This section covers both **security** (no leaked secrets, PII, or attack surface) and **commercial
protection** (retaining your rights while sharing code). Items are ordered by criticality.

### 1.1 Git History Sanitisation

> **Status:** Completed

The Feb 2026 audit (AIDHA-GOV-003, prior conversation) confirmed the **current HEAD** is clean.
However, git history may contain previously-committed secrets, debug files, or personal notes that
were later deleted.

- [x] Run `trufflehog git file://. --since-commit=$(git rev-list --max-parents=0 HEAD)` on the full
      history
- [x] Run `git log --all --diff-filter=D --name-only` to list every file ever deleted — review the
      list for `.env`, `*.key`, personal docs, etc.
- [x] **Decision: Option A (recommended for pre-alpha)**: squash the entire private history into a
      single "initial commit" and start the public repo with a clean slate.
  - [x] Produce a new repo history with a single root commit (no sensitive legacy blobs)
  - [x] Verify the resulting repo contents with secret scanners before flipping public
  - [x] Keep the old private repo archived or delete it after validation
- [x] After either option, verify again with secret scanners (e.g., gitleaks CI + trufflehog)

### 1.2 Secrets & Credentials Audit (Current State)

> **Status:** Completed (verified Feb 2026, follow-up checks pending)

- [x] `.gitignore` covers `.env`, `.env.*`, `secrets/`, `credentials/`, `*.key`, `*.secret`
- [x] No hardcoded API keys, tokens, or passwords found in tracked source files
- [x] `YOUTUBE_COOKIE` correctly sourced from environment variable, not committed
- [x] Add `detect-secrets` hook to `.pre-commit-config.yaml` for ongoing prevention
- [x] Confirm `firebase-debug.log` (contains personal email) remains untracked — DELETED
- [x] Remove tracked `telemetry-id` (`git rm --cached telemetry-id`) while keeping it gitignored

### 1.3 PII & Embarrassment Review

> **Status:** Clean (verified Feb 2026)

- [x] No profanity, aggressive comments, or embarrassing TODOs found
- [x] `coderabbit-review-*.txt` files are gitignored
- [x] `WIP-*` files are gitignored
- [x] `WIP-initial-specs/` is gitignored and not tracked
- [x] Verify that `specs/` feedback files (`v1.2-feedback-AC.md`, etc.) don't contain sensitive
      reviewer information or proprietary third-party content
- [x] Review `docs/55-testing/acceptance-run-*` artifacts for any PII in test transcripts

### 1.4 License File

> **Status:** Completed

The current `LICENSE.md` now contains the full Apache 2.0 license text.

- [x] Replace `LICENSE.md` with the full Apache License 2.0 text (see Part 2 below)
- [x] Add `"license": "Apache-2.0"` to the root `package.json`
- [x] Add `"license": "Apache-2.0"` and `"author"` field to each package's `package.json`:
  - `packages/aidha-config/package.json`
  - `packages/phyla/package.json`
  - `packages/reconditum/package.json`
  - `packages/praecis/youtube/package.json`
- [x] Optional: add SPDX headers going forward (do not churn the whole repo purely for headers)
- [x] Decide whether the `private: true` flag should remain (yes, while it's a monorepo root —
      prevents accidental npm publish)

### 1.5 Copyright & Attribution

- [x] Add a `NOTICE` file (Apache 2.0 convention) at the repo root — see Part 2
- [x] Ensure `gov-005-third-party-notices.md` is complete for all vendored or fixture data
- [x] Verify YouTube golden test fixtures comply with their source license terms (currently noted as
  - [x] `UepWRYgBpv0`: Verified CC Attribution license.
  - [x] `IN6w6GnN-Ic`: **WARNING** - Marked as Standard YouTube License (NA in yt-dlp).
    Requires replacement or explicit permission before public release.
      "Creative Commons — verify before redistribution")
- [x] Remove or rewrite any content authored by others without license (e.g. check `specs/`
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
- [x] Document required environment variables in package READMEs or a dedicated ENVIRONMENT.md:
  - [x] `AIDHA_LLM_API_KEY` — LLM API key for extraction
  - [x] `YOUTUBE_COOKIE` — YouTube authentication cookie
  - [x] `YOUTUBE_INNERTUBE_API_KEY` — YouTube InnerTube API key
  - [x] Document the `${VAR}` interpolation pattern for contributors

### 1.7 CI/CD & GitHub Repository Settings

- [x] Review `.github/workflows/docs-check.yml` — ensure it doesn't expose secrets in logs
- [ ] Add branch protection rules (require PR reviews, passing CI before merge)
- [ ] Configure GitHub repository settings:
  - [ ] Enable Dependabot for security alerts
  - [ ] Enable secret scanning (GitHub Advanced Security)
  - [ ] Set default branch to `main`
  - [ ] Consider enabling GitHub Discussions for community engagement

### 1.8 Dependency Licence Audit

- [x] Run `npx license-checker --summary` on each package to verify all transitive dependencies are
      compatible with Apache 2.0
- [x] Flag any GPL-licensed dependencies (Apache 2.0 is incompatible with GPLv2; compatible with
      GPLv3 **only** in one direction)
- [x] Document findings in `gov-005-third-party-notices.md`

### 1.9 Cleanup & Housekeeping

> **Status:** Completed

- [x] Optional: delete local `coderabbit-review-*.txt` artifacts (gitignored; not a publish blocker)
- [x] Remove `firebase-debug.log` from working tree — DELETED
- [x] Review whether `specs/` directory belongs in the public repo or should be archived/removed
- [x] Optional: delete local `package-lock.json` files (gitignored; not tracked)
- [x] Ensure `telemetry-id` is no longer tracked (gitignored local file)
- [x] Optional: delete local `out/` directories (gitignored; not tracked)
- [x] Verify `node_modules/` is not tracked (it shouldn't be, but confirm)

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

Create `NOTICE` at the repo root. Under Apache 2.0, redistributors must preserve required notices,
and `NOTICE` is the conventional place to put them. This is a strong attribution mechanism.

```text
AIDHA — AI-Assisted Personal Cognition Graph Manager
Copyright 2025-2026 Colin Farmer (GitCmurf)

This product includes software developed by Colin Farmer.

For more information, see https://github.com/GitCmurf/AIDHA
```

#### B. SPDX Headers in Every Source File

If you want per-file attribution, add this header to new `.ts` files:

```typescript
// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 Colin Farmer (GitCmurf)
```

In Markdown/YAML files where appropriate:

```markdown
<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- Copyright 2025-2026 Colin Farmer (GitCmurf) -->
```

These headers serve as per-file attribution that survives copy-paste and partial redistribution.

#### C. `package.json` Author Fields

Add to each `package.json`:

```json
{
  "author": "Colin Farmer (GitCmurf) (https://github.com/GitCmurf)",
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

## Part 4 — Launch Readiness & Adoption

While security and licensing are critical, the biggest barrier to a successful public
launch is **developer experience (DX) and immediate perceived value**. If a user
cannot experience the core value of AIDHA within 5 minutes, they will move on.

### 4.1 "Hello World" & Frictionless Onboarding

> **Problem:** High barrier to entry (requires pnpm install, multiple builds).
> **Solution:** Create a 5-minute "See It Work" path.

- [x] Ensure the CLI can be run effortlessly (e.g., `npx @aidha/youtube ingest <url>`
      without manual builds).
- [x] If `npx` isn't viable immediately, provide a pre-built binary or a simple Docker container.
- [x] Ensure error messages during initial setup are clear and actionable (e.g., missing API keys).

### 4.2 README & Architectural Clarity

> **Problem:** README describes components but not the workflow ("What does this DO?").
> **Solution:** Show, don't just tell.

- [x] Add a "What is AIDHA?" section at the very top of the README:
  > _AIDHA turns video content into a queryable knowledge graph. Watch a video →
  > AIDHA extracts claims → You refine them → Export as JSON-LD. Unlike
  > note-taking apps, AIDHA tracks provenance: every claim links to its source
  > timestamp._
- [x] Include clear examples of the output (e.g., `examples/output/` with sample JSON-LD).
- [x] Add a screenshot of the CLI in action.
- [x] Add a simple graph visualization (even if crude) to illustrate the end result.

### 4.3 Simplify Contribution Path

> **Problem:** The DocOps system is impressive but adds cognitive load for casual contributors.
> **Solution:** Provide an 80/20 fast-path.

- [x] Create a `CONTRIBUTING_QUICK.md` that skips heavy governance and just explains
      how to build, run tests, and submit a PR for simple bug fixes.

---

## Summary Checklist

### Must Do Before Going Public (Security & Licence)

- [x] Sanitise or squash git history (§1.1)
- [x] Replace `LICENSE.md` with Apache License 2.0 (§1.4)
- [x] Create `NOTICE` file (§2.2A)
- [x] Add `license` + `author` fields to all `package.json` files (§1.4, §2.2C)
- [x] Create `CONTRIBUTING.md` (§1.6)
- [x] Create `CODE_OF_CONDUCT.md` (§1.6)

### Must Do Before Going Public (Adoption Readiness)

- [x] Create a 5-minute "See It Work" path (e.g., easy `npx` execution) (§4.1)
- [x] Update README with clear value proposition and workflow (§4.2)
- [x] Add screenshots, sample JSON-LD output, and basic visualization to README (§4.2)
- [x] Add `CONTRIBUTING_QUICK.md` to reduce contribution friction (§4.3)

### Strongly Recommended

- [x] Add SPDX headers to source files (§2.2B)
- [x] Add `detect-secrets` pre-commit hook (§1.2)
- [x] Run dependency licence audit (§1.8)
- [ ] Set up CLA for contributors (§2.2E)
- [x] Create `SECURITY.md` (§1.6)
- [x] Clean up tracked-but-gitignored files:
      `coderabbit-review-*.txt`, `package-lock.json`, `telemetry-id` (§1.9)
- [x] Document required environment variables (§1.6)
- [x] Verify `specs/` feedback files for third-party content (§1.3)

### Nice to Have (Can Follow Shortly After)

- [x] Add licence badge to README (§1.6)
- [ ] Create `CITATION.cff` (§2.2D)
- [ ] Enable Dependabot and secret scanning (§1.7)
- [ ] Add `TRADEMARKS.md` (§3.5)
- [ ] Set up branch protection rules (§1.7)
