export const INGEST_USAGE_LINES = [
  'aidha ingest youtube (--url <videoIdOrUrl> | --playlist <playlistIdOrUrl>) [--mock] [--json]',
  'aidha ingest web --url <url> [--json]',
  'aidha ingest pdf --file <path> [--json]',
  'aidha ingest voice --file <path> [--json]',
  'aidha ingest meeting --file <path> [--json]',
  'aidha ingest rss --feed <url> [--item-guid <guid>] [--json]',
  'aidha ingest podcast --feed <url> [--episode <guid>] [--panel] [--json]',
  'aidha ingest readwise --since <iso8601> [--token <token>] [--json]',
  'aidha ingest email --file <path> [--json]',
  'aidha ingest linkedin --paste <text> [--url <url>] [--json]',
] as const;

export const CLI_USAGE_TEXT = `AIDHA CLI

Usage:
  aidha config explain <key> [--config <path>] [--profile <name>] [--source <id>]
  ${INGEST_USAGE_LINES.join('\n  ')}

Notes:
  - Ingest commands run offline against local fixtures, injected mocks, or --mock where supported.
  - config explain uses the shared source registration set.
`;
