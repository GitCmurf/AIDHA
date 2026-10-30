import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { GraphStore } from '@aidha/graph-backend';
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
    if (command === 'continuity') {
      // Preserve lightweight export/config startup: load this command only when selected.
      const { runContinuity } = await import('./continuity.js');
      const { SQLiteStore } = await import('@aidha/graph-backend');
      const configOpts: { configPath?: string; profile?: string } = {};
      const configPath = optionString(options, 'config');
      const profile = optionString(options, 'profile');
      if (configPath) configOpts.configPath = configPath;
      if (profile) configOpts.profile = profile;
      const explicitlySelectedConfig = configPath ?? process.env['AIDHA_CONFIG'];
      const withStore = async <T>(work: (store: GraphStore) => Promise<T>): Promise<T> => {
        const configResult = await resolveAidhaConfig(configOpts);
        if (!configResult.ok) throw configResult.error;
        if (explicitlySelectedConfig && configResult.loadResult.config === null) {
          throw new Error('Explicit continuity config was not found: ' + explicitlySelectedConfig);
        }
        await mkdir(dirname(configResult.config.db), { recursive: true });
        const store = SQLiteStore.open(configResult.config.db);
        try {
          return await work(store);
        } finally {
          await store.close();
        }
      };
      const readCase = async (id: string, on: string) => {
        const configResult = await resolveAidhaConfig(configOpts);
        if (!configResult.ok) throw configResult.error;
        const snapshot = await SQLiteStore.readSnapshot(configResult.config.db, { scope: 'full' });
        if (!snapshot.ok) throw snapshot.error;
        const { showCase } = await import('@aidha/praecis-core');
        // This adapter exposes only getNode; no initializer, migration or write path is available.
        return await showCase({
          getNode: async nodeId => ({ ok: true, value: snapshot.value.nodes.find(node => node.id === nodeId) ?? null }),
        }, id, on);
      };
      return await runContinuity(positionals[1], options, withStore, readCase);
    }

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
    const message = command === 'continuity'
      ? err.message.replace(/[\u0000-\u001f\u007f-\u009f\p{Cf}\u2028\u2029]/gu,
        value => '\\u' + value.codePointAt(0)!.toString(16).padStart(4, '0'))
      : err.message;
    console.error(message);
    return 1;
  }
}

export function isIngestCommand(argv: readonly string[]): boolean {
  return parseCliArguments(argv).positionals[0] === 'ingest';
}
