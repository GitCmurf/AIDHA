---
document_id: AIDHA-TESTING-105
owner: Engineering
status: Draft
version: '0.1'
last_updated: 2026-11-04
title: DeepSource JavaScript Configuration Contract
type: TESTING
docops_version: '2.0'
area: CORE
---
<!-- MEMINIT_METADATA_BLOCK -->
> **Document ID:** AIDHA-TESTING-105
> **Owner:** Engineering
> **Status:** Draft
> **Version:** 0.1
> **Last Updated:** 2026-11-04
> **Type:** TESTING

# DeepSource JavaScript Configuration Contract

## Version History

| Version | Date | Author | Change Summary | Reviewers | Status | Reference |
| ------- | ---- | ------ | -------------- | --------- | ------ | --------- |
| 0.1 | 2026-11-04 | Codex | Specified supported Node, ESM and TypeScript analyzer metadata without reducing analysis coverage | — | Draft | AIDHA-PLAN-015 |

## Problem and scope

The repository's `.deepsource.toml` places `environment = "nodejs"` beside the
analyzer name and lists `typescript` as a framework plugin. The
[official analyzer reference][deepsource-reference] defines `environment` as an
array under `analyzers.meta`, lists supported framework plugins separately, and
represents TypeScript with `dialect`.

Use supported metadata to declare the existing Node.js, ECMAScript module and
TypeScript analysis context. Keep the JavaScript analyzer enabled and retain
source coverage. This change adds no analyzer exclusions, rule suppressions,
dashboard settings, subscriptions or service activation. Other analyzers retain
their existing configuration and service behaviour.

## Acceptance

[The configuration contract test][contract-test] parses the actual repository
TOML with Python's standard-library `tomllib`, available in Python 3.11 and later.
It checks the external configuration boundary rather than matching file text:

- There is one enabled JavaScript analyzer, with supported analyzer-level keys.
  Analyzer-specific settings must reside under `meta`.
- Its environment is a Node.js array, its module system supports ECMAScript
  modules, and its dialect supports TypeScript.
- Any framework plugins use documented framework identifiers; TypeScript is not
  a framework plugin.
- The configuration does not exclude source files from analysis.

The existing Docs Check workflow runs this test using its Python setup. No new
Python or JavaScript dependency is required.

## Validation and limits

Run from the repository root:

```bash
python3 scripts/test_deepsource_config.py
node scripts/meminit-check.mjs docs/55-testing/testing-105-deepsource-config-contract.md
pnpm docs:build
```

Before the metadata repair, the regression fails because `environment` is an
unsupported analyzer-level key. After the repair it passes against parsed TOML.
The test validates the declared local contract; it does not run DeepSource or
prove that the hosted service consumes a pull request's configuration.

The official reference already documents Node.js/browser environments, ECMAScript
modules and TypeScript as defaults, with environment auto-detection. Correcting
the declarations therefore does not establish the cause of a hosted finding or
predict that a red JavaScript report will turn green. Inspect the actual report
on the final revision separately; an unread failure remains unresolved.

[deepsource-reference]: https://docs.deepsource.com/docs/platform/reference/core-analyzers#javascript
[contract-test]: https://github.com/GitCmurf/AIDHA/blob/49a852e11608753fb79518e91a664741e74c2405/scripts/test_deepsource_config.py
