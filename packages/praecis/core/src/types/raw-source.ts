// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 Colin Farmer (GitCmurf)

/**
 * Acquire output — the raw resource package handed to the Decode chain.
 */
export interface RawSource {
  canonicalId: string;      // e.g. "web:https://example.com/a"
  /** Additional deterministic identities used by the dedup resolver. */
  dedupKeys?: string[];     // e.g. ["web:https://canonical.com/a", "doi:10.1234/xyz"]
  sourceType: string;       // extended reconditum SourceType name
  sensitivity: 'public' | 'personal' | 'confidential';
  provenance: {
    sourceUri?: string;
    ingestedAt: string;     // ISO 8601
    pipelineVersion?: string;
    sourceType: string;
  };
  /** Opaque payload the decode chain understands (file path, html, api rows…). */
  payload: unknown;
  /** Human-readable Resource label. */
  label: string;
}
