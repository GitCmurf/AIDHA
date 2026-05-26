// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 Colin Farmer (GitCmurf)

export type { VectorSpec, ComposedVector } from './vector.js';
export { composeVector, transcribeStrategy, diarizeStrategy } from './vector.js';

export {
  createIngestionRuntime,
  createIngestionRuntimeFromServices,
  type ConfiguredIngestionRuntime,
  type IngestionRuntimeOwnership,
} from './ingestion-runtime.js';

export type { DedupAction, DedupResult } from './dedup-resolver.js';
export { DedupResolver } from './dedup-resolver.js';

export type { DedupLinkResult } from './dedup-link.js';
export { applyDedupResolution } from './dedup-link.js';
