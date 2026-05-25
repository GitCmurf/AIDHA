// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 Colin Farmer (GitCmurf)

import type { PipelineServices, PipelineRuntime, IngestInput, RunReport } from '../interfaces/index.js';
import type { Result } from '@aidha/taxonomy';
import type { ComposedVector } from './vector.js';
import { runVector } from '../pipeline/spine.js';
import { createDefaultPipelineServices } from '../pipeline/services.js';

/**
 * Low-level runtime primitive for core tests and runtime composition.
 *
 * Production entrypoints should use createIngestionRuntime(), which resolves
 * configured services, taxonomy persistence, and lifecycle ownership in one
 * place before delegating to this primitive.
 */
export function createPipelineRuntime(services: Partial<PipelineServices> = {}): PipelineRuntime {
  const registry = new Map<string, ComposedVector>();
  const runtimeServices = createDefaultPipelineServices(services);

  function routeFor(vector: ComposedVector): string {
    return runtimeServices.privacy.routes?.[vector.sensitivity] ?? runtimeServices.privacy.defaultRoute;
  }

  return {
    register(vector: { readonly sourceId: string }): void {
      const cv = vector as ComposedVector;
      if (registry.has(cv.sourceId)) {
        throw new Error(`PipelineRuntime: duplicate sourceId "${cv.sourceId}"`);
      }
      const route = routeFor(cv);
      if (route === 'disabled') {
        throw new Error(`PipelineRuntime: privacy policy disables "${cv.sourceId}" (${cv.sensitivity})`);
      }
      if (route === 'cloud' && cv.sensitivity === 'confidential') {
        throw new Error(`PipelineRuntime: confidential source "${cv.sourceId}" cannot use cloud extraction`);
      }
      registry.set(cv.sourceId, cv);
    },

    async run(sourceId: string, input: IngestInput): Promise<Result<RunReport>> {
      const vector = registry.get(sourceId);
      if (!vector) {
        return { ok: false, error: new Error(`PipelineRuntime: no vector registered for "${sourceId}"`) };
      }
      return runVector(vector, input, runtimeServices);
    },
  };
}
