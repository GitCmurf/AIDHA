// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 Colin Farmer (GitCmurf)

import type { PipelineServices, PipelineRuntime, IngestInput, RunReport } from '../interfaces/index.js';
import type { Result } from '@aidha/taxonomy';
import type { ComposedVector } from './vector.js';

export function createPipelineRuntime(_services: PipelineServices): PipelineRuntime {
  const registry = new Map<string, ComposedVector>();

  return {
    register(vector: { readonly sourceId: string }): void {
      const cv = vector as ComposedVector;
      if (registry.has(cv.sourceId)) {
        throw new Error(`PipelineRuntime: duplicate sourceId "${cv.sourceId}"`);
      }
      registry.set(cv.sourceId, cv);
    },

    async run(_sourceId: string, _input: IngestInput): Promise<Result<RunReport>> {
      throw new Error('PipelineRuntime.run() not yet implemented — requires spine (CP-0c)');
    },
  };
}
