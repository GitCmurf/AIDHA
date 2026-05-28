// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 Colin Farmer (GitCmurf)

import type { GraphNode, GraphStore } from '@aidha/graph-backend';
import type { Result } from '@aidha/taxonomy';
import type { RawSource } from '../types/index.js';

export type DedupAction = 'create' | 'merge' | 'corroborate';

export interface DedupResult {
  readonly action: DedupAction;
  readonly matchedKey?: string;
  readonly matchedNode?: GraphNode;
}

const STRONG_PREFIXES = ['web:', 'doi:', 'isbn:', 'email:thread:'] as const;

function isStrongKey(key: string): boolean {
  return STRONG_PREFIXES.some(prefix => key.startsWith(prefix));
}

export class DedupResolver {
  constructor(private readonly store: GraphStore) {}

  async resolve(source: RawSource): Promise<Result<DedupResult>> {
    // Step 1: try canonicalId — always merge if found
    const canonicalResult = await this.store.findResourceByIdentity(source.canonicalId);
    if (!canonicalResult.ok) return canonicalResult as Result<DedupResult>;
    if (canonicalResult.value !== null) {
      return {
        ok: true,
        value: {
          action: 'merge',
          matchedKey: source.canonicalId,
          matchedNode: canonicalResult.value,
        },
      };
    }

    // Step 2: try each dedupKey in order
    for (const key of source.dedupKeys ?? []) {
      const keyResult = await this.store.findResourceByIdentity(key);
      if (!keyResult.ok) return keyResult as Result<DedupResult>;
      if (keyResult.value !== null) {
        const action: DedupAction = isStrongKey(key) ? 'merge' : 'corroborate';
        return {
          ok: true,
          value: {
            action,
            matchedKey: key,
            matchedNode: keyResult.value,
          },
        };
      }
    }

    // Step 3: no match
    return { ok: true, value: { action: 'create' } };
  }
}
