export interface ParsedArgs {
  positionals: string[];
  options: Record<string, string | boolean>;
}

/** Options that are ALWAYS boolean (never consume next token). */
const BOOLEAN_OPTIONS = new Set([
  'json',
  'mock',
  'yes',
  'force',
  'dry-run',
  'interactive',
  'user-global',
  'base-dir',
  'show-secrets',
  'raw',
  'llm',
  'editor-llm',
  'editorial-diagnostics',
  'include-editor',
  'pretty',
  'include-drafts',
  'include-rejected',
  'split-states',
  'help',
  'version',
  'refresh-transcript',
  'ytdlp-keep',
  'with-manual-baselines',
  'judge',
  'resume',
  'clear-all',
]);

/** Options that MUST take a value. */
const VALUED_OPTIONS = new Set([
  'config',
  'profile',
  'source',
  'db',
  'model',
  'editor-version',
  'window-minutes',
  'max-per-window',
  'min-windows',
  'min-words',
  'min-chars',
  'claims',
  'chunk-minutes',
  'max-chunks',
  'prompt-version',
  'source-prefix',
  'ytdlp-bin',
  'ytdlp-cookies',
  'ytdlp-remote-components',
  'ytdlp-timeout',
  'ytdlp-js-runtimes',
  'cache-dir',
  'embedding-batch-size',
  'run-id',
  'corpus',
  'transcript-dir',
  'output-dir',
  'format',
  'models',
  'judge-models',
  'variants',
  'max-concurrency',
  'extraction-max-tokens',
  'extraction-max-chunks',
  'judge-max-tokens',
  'timeout-ms',
  'invalidate-run',
  'probe-url',
  'video-id',
  'source-url',
  'track',
  'out',
  'limit',
  'project',
  'area',
  'goal',
  'state',
  'text',
  'task-title',
  'top',
  'from-claim',
  'title',
  'id',
  'description',
  'name',
]);

export function parseArgs(argv: string[]): ParsedArgs {
  const positionals: string[] = [];
  const options: Record<string, string | boolean> = {};

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg) continue;

    if (arg === '--') {
      positionals.push(...argv.slice(i + 1));
      break;
    }

    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const isBoolean = BOOLEAN_OPTIONS.has(key);
      const isValued = VALUED_OPTIONS.has(key);
      const next = argv[i + 1];

      if (isBoolean) {
        options[key] = true;
      } else if (isValued && next !== undefined) {
        options[key] = next;
        i += 1;
      } else if (next !== undefined && !next.startsWith('-')) {
        // Legacy behavior for unknown flags: consume if next is not a flag
        options[key] = next;
        i += 1;
      } else {
        options[key] = true;
      }
    } else {
      positionals.push(arg);
    }
  }

  return { positionals, options };
}
