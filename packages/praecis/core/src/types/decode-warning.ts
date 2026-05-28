// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 Colin Farmer (GitCmurf)

/**
 * Non-fatal, per-unit decode problem surfaced on the warnings side-channel.
 */
export interface DecodeWarning {
  readonly unit: string;    // e.g. 'page 4', 'enclosure', 'message <id>'
  readonly reason: string;  // e.g. 'no text layer; OCR unavailable'
}
