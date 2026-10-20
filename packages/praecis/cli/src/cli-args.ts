export interface CliOptions {
  [key: string]: string | boolean | undefined;
}

export interface ParsedCliArguments {
  readonly positionals: string[];
  readonly options: CliOptions;
}

export function parseCliArguments(argv: readonly string[]): ParsedCliArguments {
  const positionals: string[] = [];
  const options: CliOptions = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg) continue;
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('-')) {
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

export function optionString(options: CliOptions, key: string): string | undefined {
  const value = options[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

export function validateConfigSelectorOptions(options: CliOptions): void {
  for (const key of ['config', 'profile'] as const) {
    const value = options[key];
    if (value !== undefined && (typeof value !== 'string' || value.length === 0)) {
      throw new Error(`--${key} requires a value`);
    }
  }
}
