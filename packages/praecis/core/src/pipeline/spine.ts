// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 Colin Farmer (GitCmurf)

import type { IngestInput, RunReport } from '../interfaces/index.js';
import type { ComposedVector } from '../compose/vector.js';
import type { Result } from '@aidha/taxonomy';
import type { DecodeWarning } from '../types/index.js';

export async function runVector(
  vector: ComposedVector,
  input: IngestInput,
): Promise<Result<RunReport>> {
  const startMs = Date.now();

  const ingestResult = await vector.ingestAndDecode(input);
  if (!ingestResult.ok) return ingestResult;

  const { raw, segments, warnings } = ingestResult.value;

  const chunkResult = await vector.chunking.chunk({ segments, context: {} });
  if (!chunkResult.ok) return chunkResult;

  const warningMessages = warnings.map((w: DecodeWarning) => `${w.unit}: ${w.reason}`);

  return {
    ok: true,
    value: {
      sourceId: vector.sourceId,
      canonicalId: raw.canonicalId,
      claimsExtracted: 0,
      warnings: warningMessages,
      durationMs: Date.now() - startMs,
    },
  };
}
