// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 Colin Farmer (GitCmurf)

import type { Result } from '@aidha/taxonomy';
import type { ComposedVector } from './vector.js';
import { createPipelineRuntime } from './runtime.js';
import type { IngestInput, PipelineRuntime, PipelineServices, RunReport } from '../interfaces/index.js';
import { createConfiguredPipelineServices } from '../pipeline/services.js';

export interface ConfiguredIngestionRuntime extends PipelineRuntime {
  runVector(vector: ComposedVector, input: IngestInput): Promise<Result<RunReport>>;
  close(): Promise<void>;
}

export async function createIngestionRuntime(
  overrides: Partial<PipelineServices> = {},
): Promise<Result<ConfiguredIngestionRuntime>> {
  const services = await createConfiguredPipelineServices(overrides);
  if (!services.ok) return services;

  const runtime = createPipelineRuntime(services.value);
  const registered = new Set<string>();
  const ownsStore = overrides.store === undefined;
  const ownsTaxonomyRegistry = overrides.taxonomyRegistry === undefined;

  function register(vector: { readonly sourceId: string }): void {
    runtime.register(vector);
    registered.add(vector.sourceId);
  }

  return {
    ok: true,
    value: {
      register,
      run(sourceId: string, input: IngestInput): Promise<Result<RunReport>> {
        return runtime.run(sourceId, input);
      },
      runVector(vector: ComposedVector, input: IngestInput): Promise<Result<RunReport>> {
        const singleRunRuntime = createPipelineRuntime(services.value);
        singleRunRuntime.register(vector);
        return singleRunRuntime.run(vector.sourceId, input);
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
