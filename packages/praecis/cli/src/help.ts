export function createCliUsageText(ingestUsageLines: readonly string[]): string {
  return `AIDHA CLI

Usage:
  aidha config explain <key> [--config <path>] [--profile <name>] [--source <id>]
  ${ingestUsageLines.join('\n  ')}
  aidha query <text...> [--project <id>] [--source <id>] [--limit <n>] [--include-drafts] [--json]
  aidha task create --from-claim <claimId> --title <title> [--project <id>] [--json]
  aidha task show <taskId> [--json]
  aidha review next [--project <id>] [--source <id>] [--limit <n>] [--json]
  aidha trace list [--project <id>] [--all] [--json]
  aidha trace show <traceId> [--json]
  aidha trace reject <traceId> [--reason <text>] [--json]
  aidha project reentry --project <id> [--json] [--markdown] [--out <path>]
  aidha export graph --jsonld [--out <path>]

Notes:
  - Ingest commands run offline against local fixtures, injected mocks, --mock, or --mock-llm where supported.
  - config explain uses the shared source registration set.
`;
}
