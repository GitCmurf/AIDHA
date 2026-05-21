// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 Colin Farmer (GitCmurf)

import type {
  IngestInput,
  RunReport,
  PipelineServices,
  ExtractionContext,
} from '../interfaces/index.js';
import type { ComposedVector } from '../compose/vector.js';
import type { Result } from '@aidha/taxonomy';
import type { DecodeWarning } from '../types/index.js';
import type { ResolvedConfig } from '@aidha/config';

function emptyContext(): ExtractionContext {
  return {};
}

function countExtracted(value: unknown): number {
  if (Array.isArray(value)) {
    return value.length;
  }
  if (typeof value !== 'object' || value === null) {
    return 0;
  }
  const record = value as Record<string, unknown>;
  if (typeof record['claimsExtracted'] === 'number') {
    return record['claimsExtracted'];
  }
  if (Array.isArray(record['claims'])) {
    return record['claims'].length;
  }
  if (Array.isArray(record['items'])) {
    return record['items'].length;
  }
  return 0;
}

export async function runVector(
  vector: ComposedVector,
  input: IngestInput,
  services: Partial<PipelineServices> = {},
): Promise<Result<RunReport>> {
  const startMs = Date.now();

  const ingestResult = await vector.ingestAndDecode(input);
  if (!ingestResult.ok) return ingestResult;

  const { raw, segments, warnings } = ingestResult.value;

  const context =
    services.miner || services.editor || services.exporter || services.llm || services.cache
      ? await vector.context.build(raw, {} as ResolvedConfig)
      : emptyContext();

  const chunkResult = await vector.chunking.chunk({ segments, context });
  if (!chunkResult.ok) return chunkResult;

  const warningMessages = warnings.map((w: DecodeWarning) => `${w.unit}: ${w.reason}`);
  let claimsExtracted = 0;

  if (services.miner && services.editor && services.exporter) {
    const mined = await services.miner.mine(chunkResult.value, context);
    if (!mined.ok) return mined;

    const edited = await services.editor.edit(mined.value, context);
    if (!edited.ok) return edited;

    const exported = await services.exporter.export(edited.value, raw);
    if (!exported.ok) return exported;

    claimsExtracted = countExtracted(edited.value) || countExtracted(mined.value) || countExtracted(exported.value);
  }

  return {
    ok: true,
    value: {
      sourceId: vector.sourceId,
      canonicalId: raw.canonicalId,
      claimsExtracted,
      warnings: warningMessages,
      durationMs: Date.now() - startMs,
    },
  };
}
