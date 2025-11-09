---
document_id: AIDHA-PLAN-005
owner: Repo Maintainers
status: Draft
version: "0.9"
last_updated: 2026-02-19
title: User Configuration Profiles
type: PLAN
docops_version: "2.0"
---

<!-- MEMINIT_METADATA_BLOCK -->

> **Document ID:** AIDHA-PLAN-005
> **Owner:** Repo Maintainers
> **Approvers:** —
> **Status:** Draft
> **Version:** 0.9
> **Last Updated:** 2026-02-19
> **Type:** PLAN

# User Configuration Profiles

## Version History

| Version | Date       | Author | Change Summary                                                    | Reviewers | Status | Reference |
| ------- | ---------- | ------ | ----------------------------------------------------------------- | --------- | ------ | --------- |
| 0.1     | 2026-02-10 | AI     | Initial plan and design.                                          | —         | Draft  | —         |
| 0.2     | 2026-02-10 | AI     | Add 5-tier precedence with source defaults; drop compat concerns. | —         | Draft  | —         |
| 0.3     | 2026-02-10 | AI     | Harden for production-grade config: path semantics, safe writes, `.env`, explainability, and strict-but-extensible schema. | — | Draft | — |
| 0.4     | 2026-02-10 | AI     | Clarify dotenv/base_dir order, schema strictness for maps, path-like annotations, and decision consequences. | — | Draft | — |
| 0.5     | 2026-02-14 | AI     | Document additionalProperties conversion behavior for config mutation. | — | Draft | — |
| 0.6     | 2026-02-15 | AI     | Mark completed phases and record remaining gaps.                  | —         | Draft  | —         |
| 0.7     | 2026-02-15 | AI     | Complete Phase 3 documentation items.                             | —         | Draft  | —         |
| 0.8     | 2026-02-15 | AI     | Add scoped meminit check helper.                                 | —         | Draft  | —         |
| 0.9     | 2026-02-19 | AI     | Close remaining Phase 1 runtime env fallback gaps in praecis runtime paths. | — | Draft | — |

## Objective

Replace the ad-hoc `process.env` / CLI-flag resolution scattered across the AIDHA
codebase with a first-class, file-based configuration system. The system must
support **named profiles**, **ingestion-source defaults**, a well-defined
**five-tier precedence chain**, and **safe, auditable editing** — while remaining
human-readable and machine-parseable.

> [!NOTE]
> AIDHA is pre-alpha with no deployments. Backward compatibility with existing
> env-var patterns is **not** a design constraint — we can make clean breaks.

### Non-Goals (Explicit Scope Exclusions)

- GUI or web-based configuration editor (future work).
- Remote / cloud-synced configuration (future work).
- Per-video or per-playlist overrides (future work; could layer on top of profiles).

---

## Technical Context

- Language/runtime: TypeScript (ESM), Node.js.
- Primary packages impacted:
  - `packages/praecis/youtube` (CLI + ingestion/extraction).
  - New: `packages/aidha-config` (shared config loader/resolver/writer).
- Testing:
  - Vitest (`pnpm -C packages/aidha-config test`, `pnpm -C packages/praecis/youtube test`).
  - CLI/help-text tests are expected for all new user-facing flags/subcommands.
- Constraints:
  - Deterministic config resolution and outputs.
  - Safe-by-default handling of secrets (redaction, file permissions, no accidental commits).
  - Avoid flag proliferation by making profiles first-class and ergonomic.

## Constitution Check

1. Graph-native scope: configuration is operational data; do not introduce knowledge nodes.
2. AI-augmented touchpoints: config influences LLM calls, but config resolution
   itself stays deterministic.
3. TDD strategy: begin with failing tests for resolution, interpolation, and writer safety.
4. DevOps and DocOps impacts: update devex/runbooks; keep `pre-commit` and
   `pnpm docs:build` green.
5. pnpm workspace changes: add one leaf package with minimal deps and clear ownership.

## Terminology

- Resolved config: final typed object after applying all tiers (CLI, profile,
  source, default, hardcoded).
- Source ID: stable ingestion vector identifier (e.g., `youtube`) used to select source defaults.
- Strict validation: unknown keys rejected except explicit extension points.

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
2. **Layered resolution, no surprises** — a fixed five-tier precedence that
   every engineer and user can predict.
3. **Human-friendly, machine-parseable** — the config file is pleasant to hand-edit
   while remaining trivially loadable programmatically.
4. **Safe editing** — mutations via the API or CLI always produce a backup before
   writing. **Redaction by default** ensures secrets in output are masked.
5. **Separation of concerns** — config loading, validation, and resolution are
   pure-function modules with no side-effects, testable in isolation.
6. **Progressive disclosure** — zero configuration works out of the box; power
   users opt into profiles and overrides.
7. **Strict validation** — the system errors on unknown configuration keys to
   prevent silent failures from typos (e.g., `timeout: 5000` vs `timeout_ms`).

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

### Parser Safety

- Use a YAML library that does not evaluate arbitrary code and does not enable
  unsafe custom tags by default.
- YAML anchors/merge keys are allowed for ergonomics, but schema validation must
  still run on the fully materialized object.

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
4. `$XDG_CONFIG_HOME/aidha/config.yaml` (user-global).
   If `$XDG_CONFIG_HOME` is unset, it defaults to `$HOME/.config`.
   On macOS, it respects `~/Library/Application Support/aidha/config.yaml`
   if preferred, but standardizes on XDG for simplicity across \*nix.

If no config file is found, the system operates entirely on hardcoded defaults
(zero-config).

### Relative Path Semantics (Production-Grade Requirement)

To avoid surprises when running the CLI from different working directories, the
config system defines a single `base_dir` used to resolve relative paths in
config values such as `db`, cache directories, cookies files, and output dirs.

- If the config path is `./.aidha/config.yaml`, then `base_dir` is the parent
  directory of `./.aidha/` (the project root).
- Otherwise, `base_dir` is the directory containing the config file.
- Optional top-level `base_dir` can override the computed value.

Rule: any path-like config value is resolved relative to `base_dir` unless it is
already absolute.

#### What Counts as "Path-Like" (Avoid Drift)

Instead of maintaining a hardcoded list in `paths.ts`, mark path-typed keys in
`config.schema.json` using an explicit annotation so the rules stay
self-documenting and consistent across code and docs. Options:

- Use a custom keyword such as `x-aidha-path: true` on string fields that should
  be treated as filesystem paths (e.g., `db`, `llm.cache_dir`, `ytdlp.cookies_file`,
  `export.out_dir`, cache directories, fixture dirs).
- `paths.ts` reads the compiled schema (or a generated metadata map) to determine
  which keys are path-like.

Special cases to define and test:

- `ytdlp.bin`: if the value contains a path separator (`/`), treat it as a path
  (resolve relative to `base_dir`). If it is a bare command (e.g., `yt-dlp`),
  do not rewrite; allow PATH resolution.

### Load Order (Dotenv, Interpolation, Paths)

To avoid circular ambiguity (for example `base_dir` or paths containing
`${VAR}`), the loader uses a fixed, testable sequence:

1. Discover the active config file path.
2. Compute `base_dir_prelim` from the config file path (using the rules above,
   ignoring any `base_dir` override inside the YAML).
3. Parse YAML into a raw object.
4. If `env.dotenv_files` is present, load those `.env` files in-order.
   Dotenv paths are resolved relative to `base_dir_prelim`.
5. Apply `${VAR}` interpolation to string values using the now-loaded env vars.
6. Validate the interpolated raw config against the JSON schema.
7. If the config contains a `base_dir` override, resolve it (relative to
   `base_dir_prelim` unless absolute) and set the final `base_dir`.
8. Resolve path-like config values relative to the final `base_dir`.

This ensures `base_dir` may reference env vars defined in `.env` files, while
dotenv file paths remain stable and predictable.

Note: schema validation runs before path resolution. This is intentional: the
schema validates user-authored values (often relative paths), while path
resolution is a post-validation transform.

---

## 4. Configuration Schema Design

### Top-Level Structure

```yaml
# ~/.config/aidha/config.yaml
# AIDHA Configuration — see AIDHA-PLAN-005 for schema documentation.

# The "default" profile is always loaded first.
# Schema versioning for future migration support.
config_version: 1

# Optional: override the computed base directory for resolving relative paths.
# base_dir: .

# Optional: load one or more dotenv files before interpolation (explicit opt-in).
# env:
#   dotenv_files:
#     - ./.env
#   override_existing: false

default_profile: default

# ── System-wide defaults ──────────────────────────────────────
profiles:
  default:
    db: ./out/aidha.sqlite
    llm:
      model: gpt-4o-mini
      api_key: ${AIDHA_LLM_API_KEY} # env-var interpolation
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

# ── Ingestion-source defaults ─────────────────────────────────
# Each source provides defaults that sit between the system-wide
# default profile and any named profile. Only keys relevant to
# that source need to appear here.
sources:
  youtube: # YouTube transcript ingestion
    ytdlp:
      bin: yt-dlp
      cookies_file: ""
      timeout_ms: 120000
      js_runtimes: ""
      keep_files: false
    youtube:
      cookie: ${YOUTUBE_COOKIE:-}
      innertube_api_key: ""
      debug_transcript: false
    extraction:
      chunk_minutes: 5
      max_claims: 15

  # Future sources would go here, e.g.:
  # rss-feed:
  #   polling_interval_minutes: 30
  # pdf-ingest:
  #   ocr_engine: tesseract
```

### Config Versioning and Migration

- `config_version` is required and must be an integer.
- The binary declares its supported version via a constant (e.g.,
  `SUPPORTED_CONFIG_VERSION = 1` exported from `defaults.ts` or `schema.ts`).
- If a config file declares a higher `config_version` than the running binary
  supports, fail fast with a clear error and point users to `aidha config init`
  or a future `aidha config migrate` command.
- If a config file is older, continue to load it if it still validates; avoid
  silent behavior changes by making migrations explicit and testable.

### Key Design Decisions

1. **Flat-ish grouping** — config keys are grouped by concern (`llm`, `editor`,
   `ytdlp`, etc.) to mirror the CLI help text and allow partial profile overrides.
2. **Environment variable interpolation** — `${VAR_NAME}` syntax inside string
   values is expanded at load time. This lets secrets stay in env vars while
   non-secret config lives in the file.
3. **Optional `.env` file loading (explicit)** — the system does not auto-load
   `.env` files by default. Instead, a user may opt in via a top-level config
   stanza (loaded before interpolation):

   ```yaml
   env:
     dotenv_files:
       - ./.env
     override_existing: false
   ```

   Semantics:
   - Files are loaded in-order; later files win.
   - Paths are resolved relative to `base_dir_prelim` (computed from config path).
   - Existing `process.env` values win unless `override_existing: true`.
   - Missing dotenv files: warn and continue by default (common in multi-machine
     setups). Provide an opt-in strict mode (e.g., `env.dotenv_required: true`)
     that treats missing files as errors.
4. **Three-level inheritance** — a named profile deep-merges over the active
   source defaults, which deep-merge over the system-wide `default` profile.
   Only the keys you want to override need to appear at each level.
5. **Sensitive values** — API keys and cookies should use env-var interpolation
   (backed by shell exports or explicit `.env` loading). The config file should **never**
   be committed with secrets; `.gitignore` should include `.aidha/config.yaml`
   by default.
6. **Strict-but-extensible** — unknown keys are rejected to prevent typos, but
   the schema includes explicit extension points for custom/private keys.
   Strict validation must still apply everywhere else:

   ```yaml
   extensions:
     my_team:
       some_future_key: 123
   ```

### Interpolation Semantics (Must Be Explicit)

- Interpolation is applied only to string values (never to keys).
- `${VAR}` substitutes `VAR` when set; if unset, treat as an error (safer default)
  and report which config path referenced it.
- `${VAR:-fallback}` substitutes `fallback` when `VAR` is unset (including empty
  fallback via `${VAR:-}`).
- Provide an escape mechanism to include literal `${...}` in strings (e.g., `$$`
  or `\\${...}`), defined and tested.
- Enforce a maximum expansion depth and detect cycles (A -> B -> A).
- Note: because dotenv files (if configured) load before interpolation, `${VAR}`
  may reference variables sourced from `env.dotenv_files`.

### Resolved Runtime Shape (What Code Consumes)

The on-disk config is organized around `profiles` and `sources`. The runtime API
should return a normalized `ResolvedConfig` shape that application code reads
without needing to know which tier a value came from:

```ts
type ResolvedConfig = {
  baseDir: string;
  db: string;
  llm: { model: string; apiKey: string; baseUrl: string; timeoutMs: number; cacheDir: string };
  editor: { version: string; windowMinutes: number; maxPerWindow: number; minWindows: number; minWords: number; minChars: number; editorLlm: boolean };
  extraction: { maxClaims: number; chunkMinutes: number; maxChunks: number; promptVersion: string };
  export: { outDir: string; sourcePrefix: string };
  ytdlp: { bin: string; cookiesFile: string; timeoutMs: number; jsRuntimes: string; keepFiles: boolean };
  youtube: { cookie: string; innertubeApiKey: string; debugTranscript: boolean };
  extensions?: {
    global?: Record<string, unknown>;
    source?: Record<string, unknown>;
    profile?: Record<string, unknown>;
  };
};
```

For `aidha config explain` and for robust debugging, the resolver should also be
able to provide a companion provenance map (config path, tier, and raw origin)
without changing the `ResolvedConfig` interface consumed by the rest of the app.

Stretch: `config explain` should optionally report interpolation provenance (for
example `${AIDHA_LLM_API_KEY}`, whether it came from an `.env` file, and which
dotenv file provided it) without printing the secret value.

### JSON Schema for Validation

A JSON Schema document will be provided at
`packages/aidha-config/schema/config.schema.json`.
This enables:

- Load-time validation with clear error messages.
- **Strict validation**: The loader will reject configuration files containing
  unknown keys (except explicit extension points like `extensions`). This is
  critical for preventing "silent failures" where a user
  typos a key (e.g., `timeout: 100` instead of `timeout_ms: 100`) and the
  system silently falls back to the default, confusing the user.
- Editor auto-complete (VS Code YAML extension recognises `$schema` references).
- CI/pre-commit validation if a user checks in their config.

### Schema Strictness and Extensibility (Profiles and Sources)

The schema must be strict by default:

- Top-level: `additionalProperties: false` except for explicit extension points.
- `profiles`: a map of profile names to `Profile` objects. Unknown profile names
  are allowed, but each `Profile` object is validated strictly.
- `sources`: a map of source IDs to `SourceDefaults` objects. Unknown source IDs
  are allowed, but each `SourceDefaults` object is validated strictly.
- `extensions`: maps are allowed at the top-level, per-profile, and per-source
  as an explicit escape hatch. Keys inside `extensions` are not interpreted by
  AIDHA and are not validated beyond being JSON/YAML objects.

Note on mutation: when a schema section uses `additionalProperties: true`, type
coercion during `config set` is skipped because the schema does not define an
expected type for those keys.

Runtime shaping: `ResolvedConfig.extensions` keeps these three scopes separate
(`global`, `source`, `profile`) rather than merging them into a single map. This
avoids collisions and makes provenance easier to explain.

---

## 5. Five-Tier Precedence Chain

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
│  Tier 3  │  Ingestion-source defaults                          │
│          │  sources.<source-id>.* in config.yaml               │
│          │  Selected via --source <id> or per-command default   │
├──────────┼─────────────────────────────────────────────────────┤
│  Tier 4  │  System-wide default profile                        │
│          │  profiles.default.* in config.yaml                  │
├──────────┼─────────────────────────────────────────────────────┤
│  Tier 5  │  Hardcoded fallback defaults                        │
│          │  Built into source code; the "no config" baseline   │
└──────────┴─────────────────────────────────────────────────────┘
```

### Why Ingestion-Source Defaults (Tier 3)?

The MVP proves concept with YouTube transcript ingestion (`youtube`), but AIDHA
is designed for many ingestion vectors (RSS feeds, PDFs, podcasts, etc.). Each
source has distinct configuration concerns (e.g., `ytdlp.*` is irrelevant to
PDF ingestion). Source defaults let each vector ship sensible built-in config
**without** polluting the system-wide default profile.

The resolver applies: `CLI flags → named profile → source defaults → system
default → hardcoded fallbacks`.

### Merge Semantics (Must Be Explicit)

- Objects/maps: deep-merged recursively.
- Scalars (string/number/bool): higher tier replaces lower tier.
- Arrays: higher tier replaces lower tier (no concatenation) to avoid surprising
  behavior and to keep resolution deterministic.
- "Unset" behavior: v1 does not support "delete inherited key" semantics; to
  disable a setting, use an explicit neutral value (e.g., empty string for
  optional paths), or introduce an explicit boolean flag.

### Source Selection

- Commands that operate on a specific source (e.g., `ingest video`,
  `extract claims`) automatically select the appropriate source ID (`youtube`)
  based on the command context.
- `--source <id>` CLI flag overrides the automatic selection.
- If no source is applicable (e.g., `config show`, `diagnose stats`), Tier 3
  is skipped entirely.
- If the selected source ID is unknown, fail fast with a clear error that lists
  available source IDs (from config file plus built-in defaults).

### Environment Variables

Env vars are **not** a separate tier. Env vars referenced inside the config
file via `${VAR}` interpolation are resolved at file-load time (as part of
Tiers 2–4). If `env.dotenv_files` is configured, those files are loaded before
interpolation (without overriding existing env vars unless explicitly enabled).
Direct `process.env` reads in source code will be replaced with config lookups.

### Profile Selection

- `--profile <name>` CLI flag (highest priority).
- `$AIDHA_PROFILE` environment variable.
- `default_profile` key in the config file.
- If none of the above: use the `default` profile.
- If the selected profile name does not exist, fail fast and list available
  profiles (including the required `default` profile).

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
│   ├── types.ts                    # TypeScript types (AidhaConfig, Profile, SourceDefaults, etc.)
│   ├── schema.ts                   # Compiled schema + validation (ajv)
│   ├── defaults.ts                 # Tier 5 hardcoded defaults as a typed object
│   ├── loader.ts                   # File discovery, YAML parse, env-var interpolation
│   ├── resolver.ts                 # Five-tier merge logic (pure function)
│   ├── explain.ts                  # Produce per-key provenance (tier/path) for `config explain`
│   ├── paths.ts                    # Compute base_dir + resolve path-like values consistently
│   ├── redact.ts                   # Redact sensitive values for output/logging
│   ├── writer.ts                   # Safe write-back with atomic rename + backup (+ concurrency guard)
│   └── interpolation.ts            # ${VAR} expansion in string values
├── tests/
│   ├── defaults.test.ts
│   ├── loader.test.ts
│   ├── resolver.test.ts
│   ├── explain.test.ts
│   ├── paths.test.ts
│   ├── redact.test.ts
│   ├── writer.test.ts
│   ├── interpolation.test.ts
│   └── schema-validation.test.ts
└── README.md
```

### Module Responsibilities

| Module             | Responsibility                                                                                                        | Side-effects     |
| ------------------ | --------------------------------------------------------------------------------------------------------------------- | ---------------- |
| `types.ts`         | TypeScript interfaces: `AidhaConfig`, `Profile`, `SourceDefaults`, `ResolvedConfig`                                   | None             |
| `defaults.ts`      | `DEFAULTS: DeepReadonly<AidhaConfig>` constant (Tier 5)                                                               | None             |
| `schema.ts`        | Compile JSON Schema once; export `validate(obj)`                                                                      | None (pure)      |
| `loader.ts`        | `loadConfigFile(options?): Promise<RawConfig \| null>` — file discovery, YAML parse, optional dotenv load, interpolation | fs:read          |
| `resolver.ts`      | `resolveConfig(cliOverrides, profileName, sourceId, rawConfig, defaults): ResolvedConfig` — pure five-tier deep merge | None             |
| `explain.ts`       | Build an explanation map for resolved values (tier + config origin)                                                   | None (pure)      |
| `paths.ts`         | Compute `base_dir` and resolve path-like values deterministically                                                     | None (pure)      |
| `redact.ts`        | Redact secrets for safe printing/logging (schema-aware allowlist)                                                     | None (pure)      |
| `writer.ts`        | `writeConfig(path, config, options?): Promise<void>` — atomic write with `.bak` rotation + concurrency guard          | fs:write         |
| `interpolation.ts` | `interpolateEnvVars(value): string` — `${VAR}` expansion with loop detection                                          | None (reads env) |

### Dependency Policy

- **Runtime deps**: `yaml` (YAML parse/stringify), `ajv` (JSON Schema validation).
  Both are well-maintained, widely used, and already in the Node.js ecosystem.
- Optional runtime dep: `dotenv` for explicit `.env` file support when configured.
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
  /** If true, allow overwriting even if the file changed since it was read. */
  force?: boolean;
  /** If true, allow writing to a symlink target (not recommended). */
  allowSymlink?: boolean;
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
4. **Dry-run mode** — callers can preview what would change.
5. **Read-Only Mode** — if `AIDHA_CONFIG_READONLY=1` is set (e.g., in CI or
   Docker), all write operations throw a clear `ConfigReadOnlyError`.
6. **Concurrency guard** — prevent lost updates when multiple processes write:
   - Default: optimistic concurrency by comparing the file mtime/hash read at
     load time with the file state at write time; if changed, abort with a clear
     error and suggest re-running.
   - Optional: `--force` on CLI (and `WriteConfigOptions.force?: boolean`) to
     allow overwriting after user acknowledgement.
7. **Symlink guard** — refuse to write through symlinks by default (prevents
   accidental writes to unexpected targets). Allow an explicit override flag if
   needed.

### Comment and Formatting Preservation

`aidha config set` should not destroy user comments or reformat the entire file.
Writer implementation should use the YAML AST (`yaml.parseDocument`) and apply
targeted modifications, preserving comments and key ordering where possible.

If a particular edit cannot be applied without rewriting, the CLI must:

1. Offer `--dry-run` diff preview.
2. Create a backup before writing.
3. Warn clearly that formatting/comments may change.

### CLI Sub-commands for Config Management

```bash
aidha config show                       # Print resolved config (secrets redacted)
aidha config show --show-secrets        # Print with secrets exposed (caution!)
aidha config show --json                # Print resolved config as JSON (stable for scripts)
aidha config show --profile fast-local  # Print a specific profile
aidha config show --raw                 # Print the raw config file without resolution
aidha config explain <key>              # Show where a value came from (tier + origin)
aidha config set <key> <value>          # Set a key in the default profile
aidha config set <key> <value> --profile <name>  # Set a key in a named profile
aidha config set <key> <value> --dry-run         # Preview patch + backup without writing
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

- [x] `types.ts` — full TypeScript types matching the schema (`Profile`,
      `SourceDefaults`, `AidhaConfig`, `ResolvedConfig`).
- [x] `defaults.ts` — all current hardcoded defaults extracted and documented.
- [x] `schema/config.schema.json` — JSON Schema with descriptions for every key,
      including the `sources` section.
- [x] `schema.ts` — compiled validator.
- [x] `loader.ts` — file discovery, YAML parse, optional dotenv load, env-var interpolation.
- [x] `interpolation.ts` — `${VAR}` and `${VAR:-fallback}` expansion.
- [x] `resolver.ts` — five-tier merge (CLI → profile → source → default → hardcoded).
- [x] `paths.ts` — compute `base_dir` and resolve path-like values consistently.
- [x] `redact.ts` — schema-aware redaction allowlist for safe output/logging.
- [x] `explain.ts` — per-key provenance (`config explain`) based on resolution traces.
- [x] `writer.ts` — safe write-back with backup, comment-preserving edits, and concurrency guard.
- [x] Full test suite (see Section 10).

**Acceptance:** All unit tests pass; `pnpm -C packages/aidha-config test` green.
No changes to praecis or any other package yet.

**Status (2026-02-15):** Complete.

### Phase 1: Wire Config into Praecis CLI

- [x] Ensure `--config`, `--profile`, and `--source` flags are parsed and plumbed through.
- [x] Create a `resolveCliConfig()` function (in `cli/config-bridge.ts`) that calls
      `loadConfigFile()` → `resolveConfig()` and returns a typed, validated
      `ResolvedConfig` object.
- [x] Auto-select `--source youtube` for YouTube-related commands (`ingest`,
      `extract`, `diagnose transcript/extract/editor`).
- [x] Replace remaining runtime `process.env['AIDHA_*']` fallbacks in praecis
      execution paths with reads from `ResolvedConfig`.
- [x] Update help text (`cli/help.ts`) to document `--config`, `--profile`,
      `--source`, and the config file search path.

**Acceptance:** All existing praecis tests pass with no config file present
(zero-config). Tests pass with a config file providing equivalent values.

**Status (2026-02-19):** Complete. Runtime command paths now resolve through
`ResolvedConfig` (including diagnose/editor cache and yt-dlp runtime usage).
Environment helpers may remain for explicit library callers but are no longer
the default runtime path.

### Phase 2: Config Management CLI

- [x] Add `aidha config <subcommand>` to the CLI dispatch (`cli.ts`).
- [x] Implement `show` (default redacted, supports `--json`), `explain`, `set`
      (supports `--dry-run`), `get`, `validate`, `init`, `list-profiles`, `path`.
- [x] Add help-text tests for all new sub-commands.

**Acceptance:** `aidha config init` produces a valid, schema-compliant YAML file.
`aidha config validate` catches intentional violations.

**Status (2026-02-15):** Complete.

### Phase 3: Documentation and Devex

- [x] Add `docs/60-devex/config-guide.md` — user-facing guide with examples.
- [x] Update `docs/50-runbooks/runbook-003-youtube-ingestion.md` to reference
      config file setup.
- [x] Add an annotated example config to `examples/config.example.yaml` in the
      repo root (committed, no secrets).
- [x] Update `.gitignore` to include `.aidha/config.yaml`.
- [x] Update `AGENTS.md` to mention the config system.
- [x] Add a scoped DocOps check helper (`scripts/meminit-check.mjs`) for
      path or glob filtering.

**Status (2026-02-15):** Complete.

### Phase 4: Additional Source Vectors (Future)

- [ ] Define source defaults for new ingestion vectors as they are built
      (e.g., `rss-feed`, `pdf-ingest`, `podcast`).
- [x] Consider `aidha config init --source <id>` to scaffold source-specific
      config sections.
- [ ] Evaluate whether source-specific CLI sub-commands (e.g., `aidha rss`)
      should automatically register their source ID.

**Status (2026-02-15):** Partially complete. RSS defaults and scaffolding exist.
Additional sources and auto-registration for new commands remain future work.

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
5. **Schema validation** — prevents malformed config from causing runtime errors.
6. **Redaction in logs/output** — The `aidha config show` command and any debug
   logging must redact sensitive values by default. Redaction should be driven
   by a schema-aware allowlist (preferred) with a heuristic fallback for unknown
   fields (e.g., keys containing `api_key`, `token`, `password`, `secret`).
   The CLI must require explicit opt-in to print secrets.
7. **Circular Reference Protection** — `interpolation.ts` must detect and
   error on recursive environment variable definitions (e.g., `A=${B}`, `B=${A}`)
   to prevent infinite loops / change stack overflows.
8. **File mode warnings** — if a config file is group/world readable, warn and
   recommend `chmod 600 <path>`. Do not silently change permissions.
9. **Schema-marked secrets** — where possible, mark sensitive fields in the
   schema (or a parallel metadata map) so redaction uses an allowlist rather
   than heuristic key matching alone.

---

## 10. Verification Plan

### Automated Tests (CI-Enforced)

All tests run via: `pnpm -C packages/aidha-config test`

| Test File                   | What It Covers                                                                                                                                                          |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `defaults.test.ts`          | Default object matches schema; all keys present; types correct.                                                                                                         |
| `loader.test.ts`            | File discovery priority; YAML parse; missing file returns null; malformed YAML throws; dotenv load when configured.                                                     |
| `loader-order.test.ts`      | End-to-end loader order: base_dir_prelim → dotenv → interpolation → schema validate → base_dir override → path resolution.                                               |
| `interpolation.test.ts`     | `${VAR}` expansion; `${VAR:-fallback}` defaults; loop detection (A->B->A errors); max depth limits.                                                                     |
| `resolver.test.ts`          | Five-tier merge: CLI overrides profile; profile overrides source; source overrides default; default overrides hardcoded. Partial profiles. Source skipping. Deep merge. |
| `paths.test.ts`             | `base_dir` computation; relative path resolution; absolute paths passthrough.                                                                                           |
| `redact.test.ts`            | Schema-aware redaction and safe printing behavior; `--show-secrets` bypass.                                                                                             |
| `explain.test.ts`           | `config explain` provenance: tier selection and origin tracking.                                                                                                        |
| `writer.test.ts`            | Atomic write; backup creation; read-only mode throws; dry-run returns diff; concurrency guard prevents lost updates.                                                     |
| `schema-validation.test.ts` | Valid config passes; **unknown keys fail** (strict); type mismatches fail. `sources` section validates correctly.                                                       |

**Run command:**

```bash
pnpm -C packages/aidha-config test
```

### Integration Tests (Praecis CLI)

After Phase 1, existing tests in `packages/praecis/youtube/tests/` must
continue to pass unchanged (zero-config baseline).

Additional integration tests:

| Test                            | What It Covers                                                                              |
| ------------------------------- | ------------------------------------------------------------------------------------------- |
| `cli-config.test.ts`            | `--config`, `--profile`, and `--source` flags modify resolved options.                      |
| `cli-config-precedence.test.ts` | CLI flag → profile → source default → system default → hardcoded. All five tiers exercised. |
| `cli-config-source.test.ts`     | Auto-selection of `youtube` source for YouTube commands; `--source` override.               |
| `cli-config-explain.test.ts`    | `aidha config explain <key>` reports tier + origin and does not leak secrets by default.    |

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

| #   | Question                                                                          | Recommendation                                                                                                     |
| --- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| 1   | Should profiles support inheritance chains (profile A extends B extends default)? | **Not beyond the 3-level stack** (profile → source → default) for v1. Revisit if users request deeper chains.      |
| 2   | Should env-var interpolation support default values (`${VAR:-fallback}`)?         | **Yes** — bash-style defaults are cheap to implement and highly useful.                                            |
| 3   | Should the config file support conditional sections (e.g., platform-specific)?    | **No** for v1 — use separate profiles instead.                                                                     |
| 4   | Risk: YAML indentation errors are common.                                         | Mitigate with `aidha config validate` and clear error messages pointing to the line number.                        |
| 5   | Should `aidha config init` be fully interactive or template-based?                | **Template-first** — generate a well-annotated starter file; optional non-interactive flags; prompts later.        |
| 6   | How should monorepo sub-packages (reconditum, phyla) consume config?              | Via the shared `@aidha/config` package. Each sub-package reads only its relevant config section.                   |
| 7   | Should the config system support watching for file changes (live reload)?         | **No** for v1 — CLI tools are short-lived processes. Revisit for long-running servers.                             |
| 8   | How are new source IDs registered?                                                | Source IDs are declared in `sources:` in the config file. Commands auto-select their source by convention.         |
| 9   | Should source defaults be shipped in-code or only in the config file?             | **Both**: `defaults.ts` ships built-in source defaults; user config can override or add new sources.               |
| 10  | Should user-global and project-local config layer together?                       | **Not in v1** (single active file, per Section 3 search order). Revisit if users need layering; `aidha config path` keeps this explicit. |
| 11  | How do we prevent strict validation from blocking custom keys?                    | Provide an `extensions` map in schema; everything else remains strict.                                             |
| 12  | Will config writes destroy comments/formatting?                                   | Preserve with YAML AST edits; if rewrite is unavoidable, require `--dry-run` preview + backup + warning.           |
| 13  | How do users understand why a value is what it is?                                | `aidha config explain <key>` prints tier + origin; `aidha config show` can emit a redacted JSON payload for scripts. |

### Consequences If We Choose Differently

1. Profile inheritance chains: more flexibility, but a harder mental model and
   more conflict resolution edge cases.
2. No `${VAR:-fallback}`: fewer surprises, but significantly worse UX for
   optional secrets/cookies.
3. Conditional sections: expressive, but schema validation and determinism get
   harder; profiles are simpler.
4. Skip strict validation: faster iteration, but typos become silent failures.
5. Fully interactive init: nicer UX, but more maintenance and weaker scripted
   setup story.
6. No shared config package: reduces coupling, but guarantees drift/duplication.
7. Live reload: useful for daemons, but adds complexity for little CLI benefit.
8. No explicit source IDs: simpler surface, but multi-source scaling becomes
   ad-hoc and brittle.
9. No in-code defaults: config-only sounds clean, but zero-config onboarding
   and determinism suffer.
10. Layer global + project config: powerful, but precedence complexity increases
   and `config explain` becomes more important.
11. Disable strict validation: reduces friction for custom keys, but reintroduces
   typo-driven silent failures.
12. Rewrite YAML from plain objects: easiest to implement, but destroys comments
   and makes `config set` hostile.
13. No `config explain`: users resort to guesswork and reading source code;
   support burden rises quickly.

---

## 12. Effort Estimate

| Phase | Description               | Estimated Effort |
| ----- | ------------------------- | ---------------- |
| 0     | Shared config package     | 2–3 days         |
| 1     | Wire into praecis CLI     | 1–2 days         |
| 2     | Config management CLI     | 1 day            |
| 3     | Documentation and devex   | 0.5 day          |
| 4     | Additional source vectors | Future sprint    |

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

This table maps every current `process.env` reference to the normalized runtime
`ResolvedConfig` path (as consumed by app code). The value may come from any tier
(CLI/profile/source/default/hardcoded), and secrets should typically be provided
via interpolation rather than stored directly in YAML.

Note: on-disk defaults for YouTube live under `sources.youtube.*`, but the runtime
`ResolvedConfig` projects those into top-level fields like `ytdlp.*` and
`youtube.*` after resolution.

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
# Precedence (highest wins):
#   CLI flags → named profile → source defaults → system default → hardcoded
#
# Secrets: Use ${ENV_VAR} interpolation for API keys and cookies.
#          NEVER hardcode secrets in this file.
#
# Profiles: Define named profiles to switch between configurations.
#           Select a profile with: --profile <name>  or  AIDHA_PROFILE=<name>
#
# Schema:  https://github.com/GitCmurf/AIDHA/blob/main/packages/aidha-config/schema/config.schema.json

config_version: 1

# Optional: override computed base_dir for relative paths.
# base_dir: .

default_profile: default

# ── System-wide default profile ───────────────────────────────
# All settings here apply unless overridden by a source default,
# a named profile, or a CLI flag.
profiles:
  default:
    db: ./out/aidha.sqlite

    llm:
      model: gpt-4o-mini
      api_key: ${AIDHA_LLM_API_KEY} # from .env or shell export
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

    export:
      source_prefix: youtube
      out_dir: ./out

  # ── Named profiles (override source + system defaults) ──────
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

  production:
    llm:
      model: gpt-4o
      timeout_ms: 60000
    editor:
      version: v2
      editor_llm: true

# ── Ingestion-source defaults ─────────────────────────────────
# Source-specific config that sits between named profiles and
# the system-wide default.  Only keys relevant to each source.
sources:
  youtube: # YouTube transcript ingestion
    ytdlp:
      bin: yt-dlp
      cookies_file: ""
      timeout_ms: 120000
      js_runtimes: ""
      keep_files: false
    youtube:
      cookie: ${YOUTUBE_COOKIE:-} # optional, from .env
      innertube_api_key: ""
      debug_transcript: false
    extraction:
      chunk_minutes: 5
      max_claims: 15

  # Future sources:
  # rss-feed:
  #   polling_interval_minutes: 30
  # pdf-ingest:
  #   ocr_engine: tesseract
```
