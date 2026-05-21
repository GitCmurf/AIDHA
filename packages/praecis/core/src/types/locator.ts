// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 Colin Farmer (GitCmurf)

/**
 * Discriminated union replacing timestamp-hardcoded addressing.
 * Each kind corresponds to a distinct addressable unit type across
 * different ingestion vectors.
 */
export type Locator =
  | { kind: 'timecode'; startSec: number; endSec: number; speaker?: string }
  | { kind: 'page'; page: number; charStart: number; charEnd: number }
  | { kind: 'dom'; textFragment: string; charStart: number; charEnd: number }
  | { kind: 'message'; messageId: string; charStart: number; charEnd: number }
  | { kind: 'text'; charStart: number; charEnd: number }
  | { kind: 'external'; system: string; externalId: string };
