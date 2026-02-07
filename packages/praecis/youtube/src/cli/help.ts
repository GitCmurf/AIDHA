export const CLI_USAGE_TEXT = `AIDHA YouTube CLI

Usage:
  aidha-youtube ingest playlist <playlistIdOrUrl> [--db <path>] [--mock] [--ytdlp-keep] [--ytdlp-cookies <path>] [--ytdlp-bin <path>] [--ytdlp-timeout <ms>] [--ytdlp-js-runtimes <list>]
  aidha-youtube ingest video <videoIdOrUrl> [--db <path>] [--mock] [--ytdlp-keep] [--ytdlp-cookies <path>] [--ytdlp-bin <path>] [--ytdlp-timeout <ms>] [--ytdlp-js-runtimes <list>]
  aidha-youtube ingest status <videoIdOrUrl> [--db <path>] [--json]
  aidha-youtube extract claims <videoIdOrUrl> [--db <path>] [--llm] [--model <id>] [--claims <n>] [--chunk-minutes <n>] [--max-chunks <n>]
  aidha-youtube extract refs <videoIdOrUrl> [--db <path>]
  aidha-youtube export dossier video <videoIdOrUrl> [--db <path>] [--out <path>] [--states <accepted|draft|rejected>] [--include-drafts] [--include-rejected] [--split-states]
  aidha-youtube export dossier playlist <playlistIdOrUrl> [--db <path>] [--out <path>] [--videos <id1,id2>] [--states <accepted|draft|rejected>] [--include-drafts] [--include-rejected] [--split-states]
  aidha-youtube export transcript video <videoIdOrUrl> [--db <path>] [--out <path>] [--pretty]
  aidha-youtube export transcript playlist <playlistIdOrUrl> [--db <path>] [--out <path>] [--videos <id1,id2>] [--pretty]
  aidha-youtube query <text...> [--db <path>] [--limit <n>] [--project <id>] [--area <id>] [--goal <id>] [--states <accepted|draft|rejected>] [--include-drafts] [--include-rejected]
  aidha-youtube related --claim <claimId> [--db <path>] [--limit <n>] [--include-drafts]
  aidha-youtube review next [<videoIdOrUrl>] [--db <path>] [--limit <n>] [--state <draft|accepted|rejected|all>] [--json]
  aidha-youtube review apply --claims <id1,id2> [--accept|--reject|--draft|--state <...>] [--text "<new text>"] [--tag <a,b>] [--project <id>] [--task-title "<title>"] [--db <path>]
  aidha-youtube area create --name "<name>" [--id <id>] [--description "<text>"] [--db <path>]
  aidha-youtube goal create --name "<name>" [--id <id>] [--description "<text>"] [--area <areaId>] [--db <path>]
  aidha-youtube project create --name "<name>" [--id <id>] [--description "<text>"] [--area <areaId>] [--goal <goalId>] [--db <path>]
  aidha-youtube task create --from-claim <claimId> --title "<title>" [--project <id>] [--tag <a,b>] [--db <path>]
  aidha-youtube task create --title "<title>" [--project <id>] [--tag <a,b>] [--allow-empty] [--db <path>]
  aidha-youtube task show <taskId> [--db <path>]
  aidha-youtube diagnose transcript <videoIdOrUrl> [--mock] [--json]
  aidha-youtube diagnose extract <videoIdOrUrl> [--db <path>] [--json]

Defaults:
  --db ./out/aidha.sqlite
  --out ./out/dossier-<id>.md
`;
