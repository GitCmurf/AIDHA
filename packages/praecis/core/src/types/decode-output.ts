// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 Colin Farmer (GitCmurf)

import type { MediaSegment } from './media-segment.js';
import type { DecodeWarning } from './decode-warning.js';

/**
 * Segments plus warnings side-channel — the output of a Decode operation.
 */
export interface DecodeOutput {
  readonly segments: readonly MediaSegment[];
  readonly warnings?: readonly DecodeWarning[];
}
