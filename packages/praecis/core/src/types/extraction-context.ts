// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 Colin Farmer (GitCmurf)

/**
 * Sidecar injected into the miner prompt.
 * Provides domain hints and context for extraction tuning.
 */
export interface ExtractionContext {
  domainHints?: string[];
  topicsOfInterest?: string[];
  relatedProjectIds?: string[];
  /** Hints for selecting a chunking policy. */
  chunkingHints?: ('prose' | 'slides' | 'conversation' | 'highlight')[];
  /** Free-form source-supplied context: show notes, abstract, thread subject. */
  sourceSummary?: string;
}
