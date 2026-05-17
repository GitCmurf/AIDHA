// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 Colin Farmer (GitCmurf)

/**
 * @aidha/config — YAML config file parser with safety bounds.
 *
 * @module
 */

import { readFileSync } from 'node:fs';
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
  let content: string;
  try {
    content = readFileSync(filePath, 'utf-8');
  } catch (err) {
    throw new ConfigParseError(filePath, `Failed to read config file: ${filePath}`, { cause: err });
  }

  if (Buffer.byteLength(content, 'utf-8') > MAX_DOCUMENT_SIZE) {
    throw new ConfigParseError(
      filePath,
      `Config file exceeds maximum size of ${MAX_DOCUMENT_SIZE} bytes`,
    );
  }

  let raw: unknown;
  try {
    raw = parseYAML(content, { maxAliasCount: MAX_ALIAS_COUNT });
  } catch (err) {
    throw new ConfigParseError(filePath, `Failed to parse config file: ${filePath}`, { cause: err });
  }

  if (raw === null || typeof raw !== 'object') {
    throw new ConfigParseError(filePath, 'Config file is empty or not an object');
  }

  return raw as Record<string, unknown>;
}
