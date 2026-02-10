---
document_id: AIDHA-PLAN-005
owner: Repo Maintainers
status: Draft
version: "0.1"
last_updated: 2026-02-10
title: User Configuration Profiles
type: PLAN
docops_version: "2.0"
---

<!-- MEMINIT_METADATA_BLOCK -->

> **Document ID:** AIDHA-PLAN-005
> **Owner:** Repo Maintainers
> **Approvers:** —
> **Status:** Draft
> **Version:** 0.1
> **Last Updated:** 2026-02-10
> **Type:** PLAN

# User Configuration Profiles

## Version History

| Version | Date       | Author | Change Summary           | Reviewers | Status | Reference |
| ------- | ---------- | ------ | ------------------------ | --------- | ------ | --------- |
| 0.1     | 2026-02-10 | AI     | Initial plan and design. | —         | Draft  | —         |

## Objective

Replace the ad-hoc `process.env` / CLI-flag resolution scattered across the AIDHA
codebase with a first-class, file-based configuration system. The system must
support **named profiles**, a well-defined **four-tier precedence chain**, and
**safe, auditable editing** — while remaining human-readable and machine-parseable.

### Non-Goals (Explicit Scope Exclusions)

- GUI or web-based configuration editor (future work).
- Remote / cloud-synced configuration (future work).
- Per-video or per-playlist overrides (future work; could layer on top of profiles).

---

## 1. Current State and Gap Analysis

### What Exists Today

Configuration is resolved ad-hoc inside `packages/praecis/youtube/src/cli.ts`
(1 281 lines) and several client modules:

| Concern                                      | Mechanism                                                                                                                                   | Files                         |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| LLM model, API key, base URL, timeout        | `AIDHA_LLM_MODEL`, `AIDHA_LLM_API_KEY`, `AIDHA_LLM_BASE_URL`, `AIDHA_LLM_TIMEOUT_MS`                                                        | `cli.ts`, `llm-client.ts`     |
| Editor version and tuning                    | `AIDHA_EDITOR_VERSION`, CLI flags `--editor-version`, `--window-minutes`, `--max-per-window`, `--min-windows`, `--min-words`, `--min-chars` | `cli.ts`                      |
| yt-dlp binary, cookies, timeout, JS runtimes | `AIDHA_YTDLP_BIN`, `AIDHA_YTDLP_COOKIES_FILE`, `AIDHA_YTDLP_TIMEOUT_MS`, `AIDHA_YTDLP_JS_RUNTIMES`, `AIDHA_YTDLP_KEEP_FILES`                | `cli.ts`, `yt-dlp.ts`         |
| YouTube auth and debugging                   | `YOUTUBE_COOKIE`, `YOUTUBE_COOKIES`, `AIDHA_YOUTUBE_COOKIE`, `YOUTUBE_INNERTUBE_API_KEY`, `AIDHA_DEBUG_TRANSCRIPT`                          | `youtube.ts`                  |
| Caching and prompts                          | `AIDHA_LLM_CACHE_DIR`, `AIDHA_CLAIMS_PROMPT_VERSION`                                                                                        | `cli.ts`, `diagnose/index.ts` |
| Database path                                | `--db` flag, hardcoded default `./out/aidha.sqlite`                                                                                         | `cli.ts`                      |

**35+ `process.env` references** are spread across 6 source files with no
centralised schema, no validation, and no default-documentation contract.

### Problems

1. **No discoverability** — users must read source code to learn what env vars exist.
2. **No profiles** — switching between "production LLM" and "local mock" requires
   manually juggling shell exports or wrapper scripts.
3. **No validation** — a typo in an env var name silently falls through to a default.
4. **No audit trail** — env vars leave no persistent record of what configuration
   was active during a run.
5. **Flag proliferation** — `extract claims` already has 13 flags; further growth
   will erode usability.
6. **Duplication** — the same env-to-option fallback pattern is copy-pasted
   across `runExtract`, `runDiagnose("extract")`, and `runDiagnose("editor")`.

---

## 2. Design Principles

1. **Explicit is better than implicit** — all config keys are documented with
   types, defaults, and descriptions in a single schema.
2. **Layered resolution, no surprises** — a fixed four-tier precedence that
   every engineer and user can predict.
3. **Human-friendly, machine-parseable** — the config file is pleasant to hand-edit
   while remaining trivially loadable programmatically.
4. **Safe editing** — mutations via the API or CLI always produce a backup before
   writing, so a bad edit can be undone.
5. **Separation of concerns** — config loading, validation, and resolution are
   pure-function modules with no side-effects, testable in isolation.
6. **Progressive disclosure** — zero configuration works out of the box; power
   users opt into profiles and overrides incrementally.

---

## 3. Configuration File Format

### Format Choice: YAML

| Criterion                   | YAML                                        | TOML                     | JSON                       | Markdown               |
| --------------------------- | ------------------------------------------- | ------------------------ | -------------------------- | ---------------------- |
| Human readability           | ★★★★★                                       | ★★★★                     | ★★★                        | ★★★★★                  |
| Comments                    | ✅                                          | ✅                       | ❌                         | ✅                     |
| Nesting / hierarchy         | Natural                                     | Awkward for deep nesting | Verbose                    | Not structured         |
| Ecosystem tooling (Node.js) | Excellent (`yaml` pkg)                      | Good (`smol-toml`)       | Built-in                   | Requires custom parser |
| Existing project precedent  | `docops.config.yaml`, `pnpm-workspace.yaml` | None                     | `package.json`, `tsconfig` | Docs only              |
| Schema validation           | JSON Schema via `ajv`                       | Same                     | Same                       | Non-trivial            |
| Multi-line strings          | ✅ block scalars                            | ✅ but less ergonomic    | ❌                         | N/A                    |

**Decision: YAML** — it matches existing project conventions, allows inline
comments (critical for self-documenting profiles), supports nesting naturally,
and has proven ecosystem support. TOML would be an acceptable alternative but
introduces a new convention; JSON prohibits comments which is a dealbreaker for
a human-tunable config file.

### File Locations and Search Order

```bash
$XDG_CONFIG_HOME/aidha/config.yaml    # User-level   (~/.config/aidha/config.yaml)
$AIDHA_CONFIG                          # Override via env var (path to any .yaml)
./.aidha/config.yaml                   # Project-level (repo root)
```

Resolution priority for **file discovery** (first found wins):

1. `--config <path>` CLI flag (explicit).
2. `$AIDHA_CONFIG` env var.
3. `./.aidha/config.yaml` (project-local).
4. `$XDG_CONFIG_HOME/aidha/config.yaml` (user-global, defaulting to
   `~/.config/aidha/config.yaml` on Linux/macOS).

If no config file is found, the system operates entirely on hardcoded defaults
(backwards compatible, zero-config).

---

## 4. Configuration Schema Design

### Top-Level Structure

```yaml
# ~/.config/aidha/config.yaml
# AIDHA Configuration — see AIDHA-PLAN-005 for schema documentation.

# The "default" profile is always loaded first.
# Named profiles extend/override the default.
default_profile: default

profiles:
  default:
    db: ./out/aidha.sqlite
    llm:
      model: gpt-4o-mini
      api_key: ${AIDHA_LLM_API_KEY} # env-var interpolation (optional)
      base_url: https://api.openai.com/v1
      timeout_ms: 30000
      cache_dir: ./out/cache/claims
    editor:
      version: v2
      window_minutes: 5
      max_per_window: 3
      min_windows: 4
      min_words: 8
      min_chars: 50
      editor_llm: false
    extraction:
      max_claims: 15
      chunk_minutes: 5
      max_chunks: 0 # 0 = unlimited
      prompt_version: v1
    ytdlp:
      bin: yt-dlp
      cookies_file: ""
      timeout_ms: 120000
      js_runtimes: ""
      keep_files: false
    youtube:
      cookie: ""
      innertube_api_key: ""
      debug_transcript: false
    export:
      source_prefix: youtube
      out_dir: ./out

  # Example named profiles — users add their own.
  fast-local:
    llm:
      model: ollama/llama3
      base_url: http://localhost:11434/v1
      timeout_ms: 60000
    editor:
      version: v1
    extraction:
      max_claims: 5

  production:
    llm:
      model: gpt-4o
      timeout_ms: 60000
    editor:
      version: v2
      editor_llm: true
```

### Key Design Decisions

1. **Flat-ish grouping** — config keys are grouped by concern (`llm`, `editor`,
   `ytdlp`, etc.) to mirror the CLI help text and allow partial profile overrides.
2. **Environment variable interpolation** — `${VAR_NAME}` syntax inside string
   values is expanded at load time. This lets secrets stay in env vars while
   non-secret config lives in the file.
3. **Profile inheritance** — a named profile is deep-merged over `default`.
   Only the keys you override need to appear in the named profile.
4. **Sensitive values** — API keys and cookies should use env-var interpolation
   or be omitted from the config file entirely (resolved from env at runtime).
   The config file should **never** be committed with secrets; `.gitignore`
   should include `.aidha/config.yaml` by default.

### JSON Schema for Validation

A JSON Schema document will be provided at
`packages/aidha-config/schema/config.schema.json`.
This enables:

- Load-time validation with clear error messages.
- Editor auto-complete (VS Code YAML extension recognises `$schema` references).
- CI/pre-commit validation if a user checks in their config.

---

## 5. Four-Tier Precedence Chain

Resolution for any given config key follows this fixed priority
(highest wins):

```text
┌─────────────────────────────────────────────────────────────────┐
│  Tier 1  │  Explicit CLI flags / options                       │
│          │  e.g. --model gpt-4o  --editor-version v2           │
├──────────┼─────────────────────────────────────────────────────┤
│  Tier 2  │  Active named profile                               │
│          │  Selected via --profile <name> or $AIDHA_PROFILE     │
├──────────┼─────────────────────────────────────────────────────┤
│  Tier 3  │  Default profile in config file                     │
│          │  profiles.default.* in config.yaml                  │
├──────────┼─────────────────────────────────────────────────────┤
│  Tier 4  │  Hardcoded fallback defaults                        │
│          │  Built into source code; the "no config" baseline   │
└──────────┴─────────────────────────────────────────────────────┘
```

**Important clarification on environment variables:** Env vars are _not_
a separate tier. Instead:

- Env vars referenced inside the config file via `${VAR}` interpolation are
  resolved as part of Tier 2/3 (file loading).
- Env vars referenced directly in code today (e.g., `AIDHA_LLM_MODEL`) will be
  mapped to their config-file equivalents during migration. After migration,
  using the config file is the canonical path; direct env-var fallbacks will
  be preserved for backward compatibility but documented as **deprecated** in
  favour of config-file entries.

### Profile Selection

- `--profile <name>` CLI flag (highest priority).
- `$AIDHA_PROFILE` environment variable.
- `default_profile` key in the config file.
- If none of the above: use the `default` profile.

---

## 6. Package and Module Architecture

### New Package: `packages/aidha-config/`

A new shared package at the monorepo root to avoid tying config loading to
any single CLI tool (praecis, reconditum, phyla may all use it).

```text
packages/aidha-config/
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── schema/
│   └── config.schema.json          # JSON Schema for the YAML config
├── src/
│   ├── index.ts                    # Public API barrel export
│   ├── types.ts                    # TypeScript types (AidhaConfig, Profile, etc.)
│   ├── schema.ts                   # Compiled schema + validation (ajv)
│   ├── defaults.ts                 # Tier 4 hardcoded defaults as a typed object
│   ├── loader.ts                   # File discovery, YAML parse, env-var interpolation
│   ├── resolver.ts                 # Four-tier merge logic (pure function)
│   ├── writer.ts                   # Safe write-back with atomic rename + backup
│   ├── env-compat.ts               # Maps legacy AIDHA_* env vars → config keys
│   └── interpolation.ts            # ${VAR} expansion in string values
├── tests/
│   ├── defaults.test.ts
│   ├── loader.test.ts
│   ├── resolver.test.ts
│   ├── writer.test.ts
│   ├── env-compat.test.ts
│   ├── interpolation.test.ts
│   └── schema-validation.test.ts
└── README.md
```

### Module Responsibilities

| Module             | Responsibility                                                                                                 | Side-effects     |
| ------------------ | -------------------------------------------------------------------------------------------------------------- | ---------------- |
| `types.ts`         | TypeScript interfaces for all config shapes                                                                    | None             |
| `defaults.ts`      | `DEFAULTS: DeepReadonly<AidhaConfig>` constant                                                                 | None             |
| `schema.ts`        | Compile JSON Schema once; export `validate(obj)`                                                               | None (pure)      |
| `loader.ts`        | `loadConfigFile(options?): Promise<RawConfig \| null>` — file discovery, YAML parse, interpolation             | fs:read          |
| `resolver.ts`      | `resolveConfig(cliFlags, profileName, rawConfig, defaults): ResolvedConfig` — pure deep merge                  | None             |
| `env-compat.ts`    | `applyLegacyEnvVars(config): config` — reads `process.env` and maps to config keys; emits deprecation warnings | None (reads env) |
| `writer.ts`        | `writeConfig(path, config, options?): Promise<void>` — atomic write with `.bak` rotation                       | fs:write         |
| `interpolation.ts` | `interpolateEnvVars(value): string` — `${VAR}` → `process.env[VAR]`                                            | None (reads env) |

### Dependency Policy

- **Runtime deps**: `yaml` (YAML parse/stringify), `ajv` (JSON Schema validation).
  Both are well-maintained, widely used, and already in the Node.js ecosystem.
- **No new CLI framework** — the existing `parseArgs` in `cli/parse.ts` is
  sufficient; we add `--config` and `--profile` flags through the same mechanism.
- `aidha-config` has **zero dependency on `praecis`** — it is a leaf package.

---

## 7. Safe Editing and Backup Strategy

### API Contract (Programmatic Editing)

The `writer.ts` module exposes:

```typescript
interface WriteConfigOptions {
  /** How many .bak files to retain (default: 3). */
  maxBackups?: number;
  /** If true, perform a dry-run and return the diff without writing. */
  dryRun?: boolean;
  /** Optional comment header to prepend to the file. */
  header?: string;
}

async function writeConfig(
  filePath: string,
  config: AidhaConfig,
  options?: WriteConfigOptions,
): Promise<WriteResult>;

interface WriteResult {
  /** Path to the backup file created (if any). */
  backupPath?: string;
  /** Whether the file was actually modified. */
  modified: boolean;
  /** Human-readable diff (if dryRun). */
  diff?: string;
}
```

**Safety guarantees:**

1. **Backup before write** — before any mutation, the current file is copied to
   `<path>.bak.<ISO-timestamp>`. Old backups beyond `maxBackups` are pruned.
2. **Atomic write** — write to a temp file in the same directory, then
   `rename()` over the target (atomic on POSIX).
3. **Validation before write** — the new config is validated against the JSON
   Schema before any I/O. Invalid config is rejected with a clear error.
4. **Dry-run mode** — callers can preview what would change before committing.

### CLI Sub-commands for Config Management

```bash
aidha config show                       # Print resolved config (all tiers merged)
aidha config show --profile fast-local  # Print a specific profile, merged over default
aidha config show --raw                 # Print the raw config file without resolution
aidha config set <key> <value>          # Set a key in the default profile
aidha config set <key> <value> --profile <name>  # Set a key in a named profile
aidha config get <key>                  # Get the resolved value of a key
aidha config validate [<path>]          # Validate a config file against the schema
aidha config init                       # Create a starter config file interactively
aidha config list-profiles              # List available profile names
aidha config path                       # Print the active config file path
```

### Why API + CLI, Not Just One?

- **CLI** is the user-facing UX for interactive editing and quick adjustments.
- **API** is the contract that other packages (`praecis`, `reconditum`, CI
  scripts, future GUI) consume. The CLI is a thin wrapper around the API.

This follows the same pattern as `git config` (CLI) backed by `libgit2` (API).

---

## 8. Migration Strategy

### Phase 0: Shared Config Package (No CLI Changes)

Build and test `packages/aidha-config/` in isolation.

- [ ] `types.ts` — full TypeScript types matching the schema.
- [ ] `defaults.ts` — all current hardcoded defaults extracted and documented.
- [ ] `schema/config.schema.json` — JSON Schema with descriptions for every key.
- [ ] `schema.ts` — compiled validator.
- [ ] `loader.ts` — file discovery, YAML parse, env-var interpolation.
- [ ] `interpolation.ts` — `${VAR}` expansion.
- [ ] `resolver.ts` — four-tier merge.
- [ ] `env-compat.ts` — legacy env-var mapping with deprecation warnings.
- [ ] `writer.ts` — safe write-back with backup.
- [ ] Full test suite (see Section 10).

**Acceptance:** All unit tests pass; `pnpm -C packages/aidha-config test` green.
No changes to praecis or any other package yet.

### Phase 1: Wire Config into Praecis CLI

- [ ] Add `--config` and `--profile` flags to `cli/parse.ts`.
- [ ] Create a `resolveCliConfig()` function in `cli.ts` that calls
      `loadConfigFile()` → `resolveConfig()` and returns a typed, validated
      `ResolvedConfig` object.
- [ ] Replace all inline `process.env['AIDHA_*']` and `optionString/optionNumber`
      calls with reads from the `ResolvedConfig`.
- [ ] Add deprecation warnings for direct env-var usage when a config file is
      present.
- [ ] Update help text (`cli/help.ts`) to document `--config`, `--profile`,
      and the config file search path.

**Acceptance:** All existing praecis tests pass with **no config file present**
(backwards compatible). Tests pass with a config file providing equivalent values.

### Phase 2: Config Management CLI

- [ ] Add `aidha config <subcommand>` to the CLI dispatch (`cli.ts`).
- [ ] Implement `show`, `set`, `get`, `validate`, `init`, `list-profiles`, `path`.
- [ ] Add help-text tests for all new sub-commands.

**Acceptance:** `aidha config init` produces a valid, schema-compliant YAML file.
`aidha config validate` catches intentional violations.

### Phase 3: Documentation and Devex

- [ ] Add `docs/60-devex/config-guide.md` — user-facing guide with examples.
- [ ] Update `docs/50-runbooks/runbook-003-youtube-ingestion.md` to reference
      config file setup.
- [ ] Add an annotated example config to `examples/config.example.yaml` in the
      repo root (committed, no secrets).
- [ ] Update `.gitignore` to include `.aidha/config.yaml`.
- [ ] Update `AGENTS.md` to mention the config system.

### Phase 4: Deprecation and Cleanup (Future)

- [ ] Emit deprecation notices for bare env-var usage when a config file exists.
- [ ] After one minor version with deprecation warnings, remove direct
      env-var fallbacks from module code (keep `env-compat.ts` bridge only).
- [ ] Consider adding `aidha config migrate` to auto-generate a config file
      from current env vars.

---

## 9. Security Considerations

1. **Secrets in config files** — API keys and cookies should use `${VAR}`
   interpolation so the actual secret lives in the environment, not on disk.
   The config guide must prominently warn against hardcoding secrets.
2. **File permissions** — `config init` should create the file with `0600`
   permissions (user-readable only).
3. **`.gitignore` by default** — `.aidha/config.yaml` must be gitignored to
   prevent accidental secret commits. The example file at
   `examples/config.example.yaml` is safe to commit.
4. **Backup files** — `.bak` files inherit the same permissions as the original.
5. **Schema validation** — prevents malformed config from causing runtime errors
   or security-relevant misconfigurations.

---

## 10. Verification Plan

### Automated Tests (CI-Enforced)

All tests run via: `pnpm -C packages/aidha-config test`

| Test File                   | What It Covers                                                                                                                            |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `defaults.test.ts`          | Default object matches schema; all keys present; types correct.                                                                           |
| `loader.test.ts`            | File discovery priority; YAML parse; missing file returns null; malformed YAML throws.                                                    |
| `interpolation.test.ts`     | `${VAR}` expansion; missing var → empty string or error (configurable); nested `${}`; escaping `\${`.                                     |
| `resolver.test.ts`          | Four-tier merge: CLI overrides profile; profile overrides default; default overrides hardcoded. Partial profiles. Deep merge correctness. |
| `writer.test.ts`            | Atomic write; backup creation and rotation; dry-run returns diff; validation rejects bad config.                                          |
| `env-compat.test.ts`        | Legacy env vars map to correct config keys; deprecation warning emitted; no double-application.                                           |
| `schema-validation.test.ts` | Valid config passes; missing required field fails; extra keys fail; type mismatches fail.                                                 |

**Run command:**

```bash
pnpm -C packages/aidha-config test
```

### Integration Tests (Praecis CLI)

After Phase 1, existing tests in `packages/praecis/youtube/tests/` must
continue to pass unchanged (backwards compatibility).

Additional integration tests:

| Test                            | What It Covers                                                          |
| ------------------------------- | ----------------------------------------------------------------------- |
| `cli-config.test.ts`            | `--config` and `--profile` flags modify resolved options.               |
| `cli-config-compat.test.ts`     | Env vars still work when no config file is present.                     |
| `cli-config-precedence.test.ts` | CLI flag beats profile, profile beats default, default beats hardcoded. |

**Run command:**

```bash
pnpm -C packages/praecis/youtube test
```

### Manual Verification

1. Create `~/.config/aidha/config.yaml` with the example from Section 4.
2. Run `aidha config show` — verify output shows merged defaults.
3. Run `aidha config show --profile fast-local` — verify overrides are applied.
4. Run `aidha extract claims <videoId> --profile production` — verify the
   production LLM model is used.
5. Run `aidha config set llm.model gpt-4o-mini` — verify the file is updated
   and a `.bak` file is created.
6. Run `aidha config validate` — verify no errors on a valid file; introduce
   a typo and verify the error message is clear.

---

## 11. Open Questions and Risks

| #   | Question                                                                          | Proposed Resolution                                                                                                |
| --- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| 1   | Should profiles support inheritance chains (profile A extends B extends default)? | **No** for v1 — only two levels (named → default). Revisit if users request it.                                    |
| 2   | Should env-var interpolation support default values (`${VAR:-fallback}`)?         | **Yes** — bash-style defaults are cheap to implement and highly useful.                                            |
| 3   | Should the config file support conditional sections (e.g., platform-specific)?    | **No** for v1 — use separate profiles instead.                                                                     |
| 4   | Risk: YAML indentation errors are common.                                         | Mitigate with `aidha config validate` and clear error messages pointing to the line number.                        |
| 5   | Should `aidha config init` be fully interactive or template-based?                | **Template with comments** — generate a well-annotated starter file; interactive prompts are a future enhancement. |
| 6   | How should monorepo sub-packages (reconditum, phyla) consume config?              | Via the shared `@aidha/config` package. Each sub-package reads only its relevant config section.                   |
| 7   | Should the config system support watching for file changes (live reload)?         | **No** for v1 — CLI tools are short-lived processes. Revisit for long-running servers.                             |

---

## 12. Effort Estimate

| Phase | Description             | Estimated Effort |
| ----- | ----------------------- | ---------------- |
| 0     | Shared config package   | 2–3 days         |
| 1     | Wire into praecis CLI   | 1–2 days         |
| 2     | Config management CLI   | 1 day            |
| 3     | Documentation and devex | 0.5 day          |
| 4     | Deprecation and cleanup | Future sprint    |

**Total for Phases 0–3: ~5–6 days of focused implementation.**

---

## 13. References

- `packages/praecis/youtube/src/cli.ts` — current CLI entry point (1 281 lines).
- `packages/praecis/youtube/src/cli/help.ts` — CLI help text.
- `packages/praecis/youtube/src/extract/llm-client.ts` — LLM env-var usage.
- `packages/praecis/youtube/src/client/yt-dlp.ts` — yt-dlp env-var usage.
- `packages/praecis/youtube/src/client/youtube.ts` — YouTube cookie env-var usage.
- `docops.config.yaml` — project-level YAML config precedent.
- AIDHA-PLAN-004 — prior plan establishing `flags > env > defaults` pattern.
- AIDHA-GOV-001 — document standards.

---

## Appendix A: Environment Variable Migration Map

This table maps every current `process.env` reference to its config-file equivalent.

| Current Env Var                                                     | Config Path                 | Notes                                    |
| ------------------------------------------------------------------- | --------------------------- | ---------------------------------------- |
| `AIDHA_LLM_MODEL`                                                   | `llm.model`                 |                                          |
| `AIDHA_LLM_API_KEY`                                                 | `llm.api_key`               | Use `${AIDHA_LLM_API_KEY}` interpolation |
| `AIDHA_LLM_BASE_URL`                                                | `llm.base_url`              |                                          |
| `AIDHA_LLM_TIMEOUT_MS`                                              | `llm.timeout_ms`            |                                          |
| `AIDHA_LLM_CACHE_DIR`                                               | `llm.cache_dir`             |                                          |
| `AIDHA_EDITOR_VERSION`                                              | `editor.version`            |                                          |
| `AIDHA_CLAIMS_PROMPT_VERSION`                                       | `extraction.prompt_version` |                                          |
| `AIDHA_YTDLP_BIN` / `YTDLP_BIN`                                     | `ytdlp.bin`                 | Consolidate dual env vars                |
| `AIDHA_YTDLP_COOKIES_FILE` / `YTDLP_COOKIES_FILE` / `YTDLP_COOKIES` | `ytdlp.cookies_file`        | Consolidate triple env vars              |
| `AIDHA_YTDLP_TIMEOUT_MS`                                            | `ytdlp.timeout_ms`          |                                          |
| `AIDHA_YTDLP_JS_RUNTIMES` / `YTDLP_JS_RUNTIMES`                     | `ytdlp.js_runtimes`         | Consolidate dual env vars                |
| `AIDHA_YTDLP_KEEP_FILES`                                            | `ytdlp.keep_files`          |                                          |
| `YOUTUBE_COOKIE` / `YOUTUBE_COOKIES` / `AIDHA_YOUTUBE_COOKIE`       | `youtube.cookie`            | Consolidate triple env vars              |
| `YOUTUBE_INNERTUBE_API_KEY`                                         | `youtube.innertube_api_key` |                                          |
| `AIDHA_DEBUG_TRANSCRIPT`                                            | `youtube.debug_transcript`  |                                          |

## Appendix B: Example Annotated Config File

```yaml
# AIDHA Configuration File
# ========================
# Location: ~/.config/aidha/config.yaml  (user-global)
#       or: ./.aidha/config.yaml         (project-local)
#
# Secrets: Use ${ENV_VAR} interpolation for API keys and cookies.
#          NEVER hardcode secrets in this file.
#
# Profiles: Define named profiles to switch between configurations.
#           Select a profile with: --profile <name>  or  AIDHA_PROFILE=<name>
#
# Schema:  https://github.com/GitCmurf/AIDHA/blob/main/packages/aidha-config/schema/config.schema.json

default_profile: default

profiles:
  # ── Default profile ──────────────────────────────────────────
  # All settings here apply unless overridden by a named profile
  # or a CLI flag.
  default:
    db: ./out/aidha.sqlite

    llm:
      model: gpt-4o-mini
      api_key: ${AIDHA_LLM_API_KEY} # from environment
      base_url: https://api.openai.com/v1
      timeout_ms: 30000
      cache_dir: ./out/cache/claims

    editor:
      version: v2
      window_minutes: 5
      max_per_window: 3
      min_windows: 4
      min_words: 8
      min_chars: 50
      editor_llm: false

    extraction:
      max_claims: 15
      chunk_minutes: 5
      max_chunks: 0 # 0 = unlimited
      prompt_version: v1

    ytdlp:
      bin: yt-dlp
      cookies_file: ""
      timeout_ms: 120000
      js_runtimes: ""
      keep_files: false

    youtube:
      cookie: ${YOUTUBE_COOKIE:-} # optional, from environment
      innertube_api_key: ""
      debug_transcript: false

    export:
      source_prefix: youtube
      out_dir: ./out

  # ── Fast Local (Ollama) ──────────────────────────────────────
  fast-local:
    llm:
      model: ollama/llama3
      base_url: http://localhost:11434/v1
      api_key: "" # Ollama needs no key
      timeout_ms: 60000
    editor:
      version: v1
    extraction:
      max_claims: 5

  # ── Production ───────────────────────────────────────────────
  production:
    llm:
      model: gpt-4o
      timeout_ms: 60000
    editor:
      version: v2
      editor_llm: true
```
