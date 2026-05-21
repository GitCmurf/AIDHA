// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 Colin Farmer (GitCmurf)

import type { Locator } from './locator.js';

/**
 * Atomic addressable unit produced by Decode.
 */
export interface MediaSegment {
  /** Stable within a Resource; derived deterministically. */
  id: string;
  locator: Locator;
  /** Resolved text for the v1 text path. */
  text?: string;
  /** Future seam: handle to raw media for direct-multimodal mining. Not consumed in v1. */
  mediaRef?: { uri: string; mimeType: string; startSec?: number; endSec?: number };
  /** Optional speaker label (diarisation) or section heading (documents). */
  label?: string;
}
