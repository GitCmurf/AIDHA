export function createCliUsageText(ingestUsageLines: readonly string[]): string {
  return `AIDHA CLI

Usage:
  aidha continuity schema --kind capture|update [--config <path>] [--profile <name>]
  aidha config explain <key> [--config <path>] [--profile <name>] [--source <id>]
  aidha continuity capture --case <id> --input <json> [--config <path>] [--profile <name>]
  aidha continuity update --case <id> --input <json> [--config <path>] [--profile <name>]
  aidha continuity show --case <id> --on <YYYY-MM-DD> [--json] [--config <path>] [--profile <name>]
  ${ingestUsageLines.join('\n  ')}

Notes:
  - Ingest commands run offline against local fixtures, injected mocks, or --mock where supported.
  - config explain uses the shared source registration set.
`;
}
