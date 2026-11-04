---
document_id: AIDHA-TESTING-102
owner: Engineering
status: Draft
version: '0.1'
last_updated: 2026-11-03
title: Email Address Identity Maintenance
type: TESTING
docops_version: '2.0'
area: INGEST
---
<!-- MEMINIT_METADATA_BLOCK -->
> **Document ID:** AIDHA-TESTING-102
> **Owner:** Engineering
> **Status:** Draft
> **Version:** 0.1
> **Last Updated:** 2026-11-03
> **Type:** TESTING

# Email Address Identity Maintenance

## Version History

| Version | Date | Author | Change Summary | Reviewers | Status | Reference |
| ------- | ---- | ------ | -------------- | --------- | ------ | --------- |
| 0.1 | 2026-11-03 | Codex | Qualify the parent parser patch with canonical mailbox identity regressions and offline compatibility checks | — | Draft | Owner autonomous progress request |

## Problem and scope

The email source imports `simpleParser` from mailparser. Its locked mailparser
3.9.40 pins Nodemailer 10.1.2, affected by three moderate address-parsing advisories:
[GHSA-85x2-q946-cp5h][quoted], [GHSA-m943-m63m-w62w][group] and
[GHSA-8c8m-p3m8-cjg8][comment]. Each advisory identifies Nodemailer 10.1.4 as the
first fixed release. Fresh reads confirm these are open Dependabot records 55–57
in `pnpm-lock.yaml` before this update.

Update the existing email dependency floor from `mailparser: ^3.9.40` to
`^3.9.43`. The [upstream 3.9.43 release][release] selects Nodemailer 10.1.4 through
its normal exact dependency contract. Application code and ingestion defaults are
unchanged. Synthetic headers exercise the inbound parser;
no outbound mail, provider client, credentials or private mailbox data is used.

## Dependency contract and exact closure

The [old parent manifest][old-parent] pins Nodemailer 10.1.2 and
`@zone-eu/mailsplit` 5.4.23. The [selected parent manifest][new-parent] pins 10.1.4
and 5.4.25 respectively; its other runtime dependency requirements are identical.

| Package | Before | Selected |
| --- | --- | --- |
| mailparser | 3.9.40 | 3.9.43 |
| @zone-eu/mailsplit | 5.4.23 | 5.4.25 |
| nodemailer | 10.1.2 | 10.1.4 |

Both mailsplit versions retain exact child pins `libbase64: 1.3.3`,
`libmime: 5.4.9` and `libqp: 2.1.3`. Nodemailer has no runtime dependencies.
Installed package manifests confirm all three selected artifacts and the parent's
exact child pins. Frozen strict-peer installation accepts the generated graph.

Canonical comparison against main `da0bb2ccb7ead7c758245fa192819bcd759bf659`
confirms 174 unrelated package records and 174 unrelated snapshots are equal.
Only the email importer's mailparser requirement and resolution change; all other
importer requirements, lock metadata and root manifest bytes remain equal.
The fast-uri 3.1.9 patch and [AIDHA-TESTING-101](testing-101-fast-uri-maintenance.md)
are retained. No child override or upstream metadata change is introduced.

For the narrow resolution, temporarily set the existing email dependency to exact
`3.9.43` and run `pnpm install --lockfile-only --ignore-scripts --strict-peer-dependencies`.
Restore the final `^3.9.43` floor and run that command again. Both steps use pnpm
9.12.0's real resolver; the final frozen installation verifies the selected graph.

## Acceptance and evidence

The new [address identity tests][identity] call the real `simpleParser` public
interface with synthetic messages. They assert canonical mailbox addresses rather
than display-name summaries:

- A `>` inside a quoted local part remains inside the intended mailbox.
- A semicolon inside a group comment does not create a separate recipient; the
  single group contains the intended mailbox.
- A nested comment does not replace the intended mailbox with comment text.
- An ordinary quoted display name and multiple addresses retain their mailboxes.

On installed mailparser 3.9.40 / Nodemailer 10.1.2, the three advisory cases fail
and the ordinary control passes. The failures expose a truncated quoted address,
an extra recipient after premature group termination and an attacker mailbox read
from the nested comment. After the dependency patch, the unchanged four tests pass.

Existing [EML parsing][eml], [MIME compatibility][mime] and [parser resource
regressions][budget] pass four cases. They protect header/body handling, reply and
signature removal, encoded and quoted headers, thread references, HTML preference,
attachments and existing parser budgets. These are compatibility checks; the new
identity cases provide the specific regression evidence for the three advisories.
The application currently prefers display names in its message summary, so those
summary assertions alone do not establish canonical mailbox identity.

## Bounded verification

Run from the repository root with Node 24.22.2 and pnpm 9.12.0:

```bash
pnpm install --frozen-lockfile --strict-peer-dependencies
pnpm --filter @aidha/praecis-source-email... --fail-if-no-match --workspace-concurrency=1 -r build
pnpm --filter @aidha/praecis-source-email lint
pnpm --filter @aidha/praecis-source-email exec tsc --ignoreConfig --noEmit --strict --target ES2022 --module NodeNext --moduleResolution NodeNext --types node --esModuleInterop --skipLibCheck --noUncheckedIndexedAccess tests/address-identity.test.ts src/mailparser.d.ts
pnpm --filter @aidha/praecis-source-email exec vitest run tests/address-identity.test.ts tests/parse-eml.test.ts tests/mime-compatibility.test.ts tests/parser-budget.test.ts --maxWorkers=1 --no-file-parallelism
node scripts/meminit-check.mjs docs/55-testing/testing-102-mailparser-address-identity.md
pnpm docs:build
```

The six required package builds run serially. Email lint, the strict new-test
typecheck and the eight selected parser cases pass. The existing 15-second child
process limits and 20-second resource-test budgets are unchanged. No test
assertions, skips, thresholds or analyzer policies are weakened. The full local
workspace suite is not repeated.

Hosted default CI and actual reporting reviews remain required before merge.
After merge, verify the three named alerts have closed; the version selection and
local tests alone do not establish repository alert closure or outbound delivery
behaviour.

[quoted]: https://github.com/nodemailer/nodemailer/security/advisories/GHSA-85x2-q946-cp5h
[group]: https://github.com/nodemailer/nodemailer/security/advisories/GHSA-m943-m63m-w62w
[comment]: https://github.com/nodemailer/nodemailer/security/advisories/GHSA-8c8m-p3m8-cjg8
[release]: https://github.com/nodemailer/mailparser/releases/tag/v3.9.43
[old-parent]: https://github.com/nodemailer/mailparser/blob/v3.9.40/package.json
[new-parent]: https://github.com/nodemailer/mailparser/blob/v3.9.43/package.json
[identity]: https://github.com/GitCmurf/AIDHA/blob/110-mailparser-maintenance/packages/praecis/sources/email/tests/address-identity.test.ts
[eml]: https://github.com/GitCmurf/AIDHA/blob/93cf475d29ede62c0fed7f9148ba56bfbc765312/packages/praecis/sources/email/tests/parse-eml.test.ts
[mime]: https://github.com/GitCmurf/AIDHA/blob/93cf475d29ede62c0fed7f9148ba56bfbc765312/packages/praecis/sources/email/tests/mime-compatibility.test.ts
[budget]: https://github.com/GitCmurf/AIDHA/blob/93cf475d29ede62c0fed7f9148ba56bfbc765312/packages/praecis/sources/email/tests/parser-budget.test.ts
