// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 Colin Farmer (GitCmurf)

import type { MediaSegment } from '@aidha/praecis-core';

export interface TextExtractionOptions {
  readonly sourceId?: string;
}

export interface TextExtractionResult {
  readonly text: string;
  readonly segments: readonly MediaSegment[];
}
