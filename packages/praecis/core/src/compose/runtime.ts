// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 Colin Farmer (GitCmurf)

import type { PipelineServices, PipelineRuntime, IngestInput, RunReport } from '../interfaces/index.js';
import type { Result } from '@aidha/taxonomy';
import type { ComposedVector } from './vector.js';
import { runVector } from '../pipeline/spine.js';

export function createPipelineRuntime(services: Partial<PipelineServices> = {}): PipelineRuntime {
  const registry = new Map<string, ComposedVector>();

  return {
    register(vector: { readonly sourceId: string }): void {
      const cv = vector as ComposedVector;
      if (registry.has(cv.sourceId)) {
        throw new Error(`PipelineRuntime: duplicate sourceId "${cv.sourceId}"`);
      }
      registry.set(cv.sourceId, cv);
    },

    async run(sourceId: string, input: IngestInput): Promise<Result<RunReport>> {
      const vector = registry.get(sourceId);
      if (!vector) {
        return { ok: false, error: new Error(`PipelineRuntime: no vector registered for "${sourceId}"`) };
      }
      return runVector(vector, input, services);
    },
  };
}
