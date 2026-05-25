// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 Colin Farmer (GitCmurf)

import type { Result } from '@aidha/taxonomy';
import type { ComposedVector } from './vector.js';
import type { IngestInput, PipelineServices, RunReport } from '../interfaces/index.js';
import { runVector as runPipelineVector } from '../pipeline/spine.js';
import { createConfiguredPipelineServices } from '../pipeline/services.js';

export interface ConfiguredIngestionRuntime {
  runVector(vector: ComposedVector, input: IngestInput): Promise<Result<RunReport>>;
  close(): Promise<void>;
}

function isPipelineServices(value: Partial<PipelineServices>): value is PipelineServices {
  return value.store !== undefined
    && value.miner !== undefined
    && value.exporter !== undefined
    && value.cache !== undefined
    && value.costCeiling !== undefined
    && value.privacy !== undefined
    && value.clock !== undefined
    && value.config !== undefined
    && value.allowHeuristicFallback !== undefined;
}

export async function createIngestionRuntime(
  overrides: Partial<PipelineServices> = {},
): Promise<Result<ConfiguredIngestionRuntime>> {
  const services = isPipelineServices(overrides)
    ? { ok: true as const, value: overrides }
    : await createConfiguredPipelineServices(overrides);
  if (!services.ok) return services;

  const ownsStore = overrides.store === undefined;
  const ownsTaxonomyRegistry = overrides.taxonomyRegistry === undefined;

  return {
    ok: true,
    value: {
      runVector(vector: ComposedVector, input: IngestInput): Promise<Result<RunReport>> {
        return runPipelineVector(vector, input, services.value);
      },
      async close(): Promise<void> {
        if (ownsTaxonomyRegistry) {
          await services.value.taxonomyRegistry?.close();
        }
        if (ownsStore) {
          await services.value.store.close();
        }
      },
    },
  };
}
