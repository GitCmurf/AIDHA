export function createCliUsageText(ingestUsageLines: readonly string[]): string {
  return `AIDHA CLI

Usage:
  aidha config explain <key> [--config <path>] [--profile <name>] [--source <id>]
  ${ingestUsageLines.join('\n  ')}

Notes:
  - Ingest commands run offline against local fixtures, injected mocks, or --mock where supported.
  - config explain uses the shared source registration set.
`;
}
