// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 Colin Farmer (GitCmurf)

import { normalizeText } from '../utils/graph-helpers.js';

export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(normalizeText(text).length / 4);
}
