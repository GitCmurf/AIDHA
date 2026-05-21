// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 Colin Farmer (GitCmurf)

export type { VectorSpec, ComposedVector } from './vector.js';
export { composeVector, transcribeStrategy, diarizeStrategy } from './vector.js';

export { createPipelineRuntime } from './runtime.js';

export type { DedupAction, DedupResult } from './dedup-resolver.js';
export { DedupResolver } from './dedup-resolver.js';
