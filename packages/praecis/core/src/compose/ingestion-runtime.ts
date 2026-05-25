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

export interface IngestionRuntimeOwnership {
  readonly store?: boolean;
  readonly taxonomyRegistry?: boolean;
}

export function createIngestionRuntimeFromServices(
  services: PipelineServices,
  ownership: IngestionRuntimeOwnership = {},
): ConfiguredIngestionRuntime {
  return {
    runVector(vector: ComposedVector, input: IngestInput): Promise<Result<RunReport>> {
      return runPipelineVector(vector, input, services);
    },
    async close(): Promise<void> {
      if (ownership.taxonomyRegistry) {
        await services.taxonomyRegistry?.close();
      }
      if (ownership.store) {
        await services.store.close();
      }
    },
  };
}

export async function createIngestionRuntime(
  overrides: Partial<PipelineServices> = {},
): Promise<Result<ConfiguredIngestionRuntime>> {
  const services = await createConfiguredPipelineServices(overrides);
  if (!services.ok) return services;

  return {
    ok: true,
    value: createIngestionRuntimeFromServices(services.value, {
      store: overrides.store === undefined,
      taxonomyRegistry: overrides.taxonomyRegistry === undefined,
    }),
  };
}
