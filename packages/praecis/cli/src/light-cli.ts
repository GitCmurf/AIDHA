import { parseGraphExport, exportGraphJsonLd } from './export-graph.js';
import { explainResolvedKey, resolveAidhaConfig } from './config-runtime.js';
import { parseCliArguments, optionString, validateConfigSelectorOptions } from './cli-args.js';
import { createCliUsageText } from './help.js';
import { INGEST_USAGE } from './ingest-usage.js';

const CLI_USAGE_TEXT = createCliUsageText(Object.values(INGEST_USAGE));

/** Run commands that do not require the ingestion and NLP runtime. */
export async function runLightCli(argv: string[]): Promise<number> {
  const { positionals, options } = parseCliArguments(argv);
  const command = positionals[0];

  try {
    validateConfigSelectorOptions(options);
    if (command === 'export') {
      const request = parseGraphExport(argv);
      const configResult = await resolveAidhaConfig(request);
      if (!configResult.ok) throw configResult.error;
      const document = await exportGraphJsonLd(configResult.config.db, request.out);
      if (document !== undefined) console.log(document);
      return 0;
    }

    if (command === 'config' && positionals[1] === 'explain') {
      const key = positionals[2];
      if (!key) {
        console.error('Usage: config explain <key> [--config <path>] [--profile <name>] [--source <id>]');
        return 1;
      }
      const configOpts: { configPath?: string; profile?: string; source?: string } = {};
      const configPath = optionString(options, 'config');
      const profile = optionString(options, 'profile');
      const source = optionString(options, 'source');
      if (configPath) configOpts.configPath = configPath;
      if (profile) configOpts.profile = profile;
      if (source) configOpts.source = source;
      const configResult = await resolveAidhaConfig(configOpts);
      if (!configResult.ok) {
        console.error(configResult.error.message);
        return 1;
      }
      const explainOpts: { profile?: string; source?: string } = {};
      if (profile) explainOpts.profile = profile;
      if (source) explainOpts.source = source;
      console.log(explainResolvedKey(key, configResult, explainOpts));
      return 0;
    }

    console.log(CLI_USAGE_TEXT);
    return 0;
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    console.error(err.message);
    return 1;
  }
}

export function isIngestCommand(argv: readonly string[]): boolean {
  return parseCliArguments(argv).positionals[0] === 'ingest';
}
