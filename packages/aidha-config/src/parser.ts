// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 Colin Farmer (GitCmurf)

/**
 * @aidha/config — YAML config file parser with safety bounds.
 *
 * @module
 */

import { readFileSync, statSync } from 'node:fs';
import { parse as parseYAML } from 'yaml';

const MAX_DOCUMENT_SIZE = 1_048_576;
const MAX_ALIAS_COUNT = 100;

/** Error thrown when config file has invalid YAML. */
export class ConfigParseError extends Error {
  constructor(public readonly filePath: string, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'ConfigParseError';
  }
}

export function parseConfigYaml(filePath: string): Record<string, unknown> {
  try {
    const stats = statSync(filePath);
    if (stats.size > MAX_DOCUMENT_SIZE) {
      throw new ConfigParseError(
        filePath,
        `Config file exceeds maximum size of ${MAX_DOCUMENT_SIZE} bytes`,
      );
    }
  } catch (err) {
    if (err instanceof ConfigParseError) throw err;
    throw new ConfigParseError(filePath, `Failed to read config file: ${filePath}`, { cause: err });
  }

  let content: string;
  try {
    content = readFileSync(filePath, 'utf-8');
  } catch (err) {
    throw new ConfigParseError(filePath, `Failed to read config file: ${filePath}`, { cause: err });
  }

  let raw: unknown;
  try {
    raw = parseYAML(content, { maxAliasCount: MAX_ALIAS_COUNT });
  } catch (err) {
    throw new ConfigParseError(filePath, `Failed to parse config file: ${filePath}`, { cause: err });
  }

  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new ConfigParseError(filePath, 'Config file is empty, not an object, or is an array');
  }

  return raw as Record<string, unknown>;
}
