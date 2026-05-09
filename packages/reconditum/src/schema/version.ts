// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 Colin Farmer (GitCmurf)

/**
 * Durable graph contract versions.
 *
 * These constants version persisted graph records and exported machine-readable
 * artifacts. They are intentionally independent from package semver: increment
 * them only when stored node/edge or export JSON contracts change.
 */
export const CURRENT_GRAPH_SCHEMA_VERSION = 1;
export const CURRENT_JSONLD_EXPORT_SCHEMA_VERSION = 1;
