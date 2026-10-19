export const INGEST_USAGE = {
  youtube: 'aidha ingest youtube (--url <videoIdOrUrl> | --playlist <playlistIdOrUrl>) [--mock] [--json]',
  web: 'aidha ingest web --url <url> [--json]',
  pdf: 'aidha ingest pdf --file <path> [--json]',
  voice: 'aidha ingest voice --file <path> [--json]',
  meeting: 'aidha ingest meeting --file <path> [--json]',
  rss: 'aidha ingest rss --feed <url> [--item-guid <guid>] [--json]',
  podcast: 'aidha ingest podcast --feed <url> [--episode <guid>] [--panel] [--json]',
  readwise: 'aidha ingest readwise --since <iso8601> [--token <token>] [--json]',
  email: 'aidha ingest email --file <path> [--json]',
  linkedin: 'aidha ingest linkedin --paste <text> [--url <url>] [--json]',
} as const;
