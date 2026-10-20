// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 Colin Farmer (GitCmurf)

/** Return the registration used by sources with no source-private config. */
export function emptySourceConfigRegistration(sourceId: string) {
  return {
    sourceId,
    validateActiveSourceConfig(value: unknown): Record<string, never> {
      if (
        value === undefined ||
        value === null ||
        (typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 0)
      ) {
        return {};
      }
      throw new Error(`${sourceId} source config does not accept source-private keys`);
    },
  };
}
