# @aidha/config

Centralized configuration management for AIDHA CLI tools.

## Installation

This package is currently `private` and intended for use inside the AIDHA pnpm workspace.

```bash
# Add as a workspace dependency to a specific package
pnpm add @aidha/config@workspace:* --filter <package-name>
```

## Features

- **YAML configuration** with strict JSON Schema validation
- **Five-tier precedence**: CLI flags → named profile → source defaults → system default → hardcoded
- **Environment variable interpolation**: `${VAR}` and `${VAR:-fallback}` with cycle detection
- **Schema-driven path resolution**: `x-aidha-path` annotations auto-resolve relative paths
- **Secret redaction**: `x-aidha-secret` annotations + heuristic masking for `aidha config show`
- **Safe writes**: atomic (temp→rename), backup rotation, validation-before-write, concurrency guard
- **Provenance tracking**: `aidha config explain` shows which tier provided each value
- **Dotenv support**: optional `.env` file loading with override control
- **Read-only mode**: `AIDHA_CONFIG_READONLY=1` prevents accidental writes

## Usage

```ts
import { loadConfig, resolveConfig, redactSecrets } from "@aidha/config";

// Load and validate config file (8-step pipeline)
const { config, baseDir } = await loadConfig();

// Resolve five tiers into a single ResolvedConfig
const resolved = resolveConfig({
  rawConfig: config,
  baseDir,
  profileName: "fast-local",
  sourceId: "youtube",
  cliOverrides: { llm: { model: "gpt-4o" } },
});

// Safe to log (secrets masked)
console.log(redactSecrets(resolved));
```

## Config file locations

1. `AIDHA_CONFIG` env var (explicit override)
2. `./.aidha/config.yaml` (project-local)
3. `$XDG_CONFIG_HOME/aidha/config.yaml`
4. `~/.config/aidha/config.yaml`

## Five-tier precedence

| Tier | Source                 | Example               |
| ---- | ---------------------- | --------------------- |
| 1    | CLI flags              | `--model gpt-4o`      |
| 2    | Named profile          | `profiles.fast-local` |
| 3    | Source defaults        | `sources.youtube`     |
| 4    | System default profile | `profiles.default`    |
| 5    | Hardcoded defaults     | `defaults.ts`         |

## Development

```bash
pnpm -C packages/aidha-config test        # Run tests
pnpm -C packages/aidha-config build       # Compile TypeScript
pnpm -C packages/aidha-config lint        # Type-check (tsc --noEmit)
```
