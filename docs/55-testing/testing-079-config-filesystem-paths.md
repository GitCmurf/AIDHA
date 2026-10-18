---
document_id: AIDHA-TESTING-079
owner: Engineering
status: Draft
version: '0.1'
last_updated: 2026-10-18
title: Configuration Filesystem Paths
type: TESTING
docops_version: '2.0'
---
<!-- MEMINIT_METADATA_BLOCK -->
> **Document ID:** AIDHA-TESTING-079
> **Owner:** Engineering
> **Status:** Draft
> **Version:** 0.1
> **Last Updated:** 2026-10-18
> **Type:** TESTING

# Configuration Filesystem Paths

## Version History

| Version | Date | Author | Change Summary | Reviewers | Status | Reference |
| ------- | ---- | ------ | -------------- | --------- | ------ | --------- |
| 0.1 | 2026-10-18 | Codex | Specify bare filesystem path resolution. | — | Draft | AIDHA-PLAN-005 |

## Contract

Every nonempty schema-marked filesystem path other than loader-owned `base_dir` resolves
against the final `base_dir`, including a bare filename. The loader resolves `base_dir`
against the preliminary base directory, as specified in PLAN-005. Absolute paths remain
absolute and empty values retain their existing meaning.
The public loader reads dotenv inputs before interpolation; the resolver then uses the
final base directory for selected profile filesystem fields. A slashless filename is not
a PATH command merely because it has no separator.

Only the source-owned YouTube `ytdlp.bin` uses command-name semantics: bare commands remain
unchanged, while separator-containing relative binary paths resolve against `base_dir`.
Both raw and validated source adapters preserve this distinction. Cookie files remain
filesystem paths. No network, process execution, model or graph write is needed to resolve config.

## Acceptance and source coverage

- `packages/aidha-config/tests/paths.test.ts` protects bare DB, cache and output names,
  existing relative paths, absolute paths, empty values and schema-qualified traversal.
- `packages/aidha-config/tests/loader-order.test.ts` exercises the public loader and resolver
  with dotenv-loaded/interpolated `base_dir` and a bare DB filename, plus bare cache/output paths.
- `packages/praecis/youtube/tests/youtube-source-adapter.test.ts` protects bare/relative/absolute/
  empty binary values and bare cookie filenames through both raw and validated adapters.

All generic helper consumers were inventoried: schema-driven traversal in `paths.ts` and
YouTube's two bin resolution paths are the runtime calls. `resolver.ts` imports the single
helper without calling it, while its actual runtime call uses `resolvePathValues`. The helper
exports remain public. Other source-private keys and extension payloads remain outside generic
schema traversal; existing tests protect this boundary.

## Validation

Begin with the failing bare-path and public-loader regressions, then run config and YouTube
package suites, builds, lint and strict checks for affected tests. Run scoped DocOps and
`pnpm docs:build`, and obtain independent review before commit. Tests use isolated temporary
config files and an explicit environment; no external services are required.
