export const CLI_USAGE_TEXT = `AIDHA YouTube CLI

Usage:
Global Options:
    --config <path>      Path to config file (default: auto-discover)
    --profile <name>     Select a configuration profile (default: "default" or from config).
    --source <id>        Select a data source (e.g. "youtube").
                        Auto-selected for source-bound commands (ingest, extract, etc.).
                        For 'config' commands, only applicable to 'get' and 'explain'.

Commands:
  aidha-youtube config path [--config <path>] [--base-dir]
  aidha-youtube config validate [--config <path>]
  aidha-youtube config list-profiles [--config <path>]
  aidha-youtube config show [--config <path>] [--profile <name>] [--show-secrets] [--raw] [--json]
  aidha-youtube config get <key> [--config <path>] [--profile <name>] [--source <id>] [--json]
  aidha-youtube config explain <key> [--config <path>] [--profile <name>] [--source <id>]
  aidha-youtube config init [--force] [--dry-run] [--user-global] [--interactive]
  aidha-youtube config set <key> <value> [--config <path>] [--dry-run]
  aidha-youtube ingest playlist <playlistIdOrUrl> [--db <path>] [--mock] [--ytdlp-keep] [--ytdlp-cookies <path>] [--ytdlp-bin <path>] [--ytdlp-timeout <ms>] [--ytdlp-js-runtimes <list>]
  aidha-youtube ingest video <videoIdOrUrl> [--db <path>] [--mock] [--ytdlp-keep] [--ytdlp-cookies <path>] [--ytdlp-bin <path>] [--ytdlp-timeout <ms>] [--ytdlp-js-runtimes <list>]
  aidha-youtube ingest status <videoIdOrUrl> [--db <path>] [--json]
  aidha-youtube extract claims <videoIdOrUrl> [--db <path>] [--llm] [--model <id>] [--claims <n>] [--chunk-minutes <n>] [--max-chunks <n>] [--editor-version <v1|v2>] [--window-minutes <n>] [--max-per-window <n>] [--min-windows <n>] [--min-words <n>] [--min-chars <n>] [--editor-llm] [--editorial-diagnostics]
  aidha-youtube extract refs <videoIdOrUrl> [--db <path>]
  aidha-youtube claims purge <videoIdOrUrl> [--db <path>]
  aidha-youtube export dossier video <videoIdOrUrl> [--db <path>] [--out <path>] [--source-prefix <prefix>] [--states <accepted|draft|rejected>] [--include-drafts] [--include-rejected] [--split-states]
  aidha-youtube export dossier playlist <playlistIdOrUrl> [--db <path>] [--out <path>] [--source-prefix <prefix>] [--videos <id1,id2>] [--states <accepted|draft|rejected>] [--include-drafts] [--include-rejected] [--split-states]
  aidha-youtube export transcript video <videoIdOrUrl> [--db <path>] [--out <path>] [--source-prefix <prefix>] [--pretty]
  aidha-youtube export transcript playlist <playlistIdOrUrl> [--db <path>] [--out <path>] [--source-prefix <prefix>] [--videos <id1,id2>] [--pretty]
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
  aidha-youtube diagnose extract <videoIdOrUrl> [--db <path>] [--json] [--include-editor] [--model <id>] [--prompt-version <id>] [--chunk-minutes <n>] [--max-chunks <n>] [--cache-dir <path>] [--editor-version <v1|v2>] [--claims <n>] [--window-minutes <n>] [--max-per-window <n>] [--min-windows <n>] [--min-words <n>] [--min-chars <n>]
  aidha-youtube diagnose editor <videoIdOrUrl> [--db <path>] [--json] [--model <id>] [--prompt-version <id>] [--chunk-minutes <n>] [--max-chunks <n>] [--cache-dir <path>] [--editor-version <v1|v2>] [--claims <n>] [--window-minutes <n>] [--max-per-window <n>] [--min-windows <n>] [--min-words <n>] [--min-chars <n>]
  aidha-youtube diagnose stats [--db <path>] [--json] [--top <n>]
  aidha-youtube export gephi [--db <path>] [--out <dir>] [--predicate <p1,p2>] [--node-type <t1,t2>] [--include-labels]
  aidha-youtube preflight youtube [--json] [--probe-url <url>]
  aidha-youtube fixtures import-ttml <path> [--video-id <id>] [--source-url <url>] [--track <name>] [--out <path>] [--pretty]

Defaults:
  --db ./out/aidha.sqlite
  --out ./out/dossier-youtube-<id>.md
`;
