// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 Colin Farmer (GitCmurf)

import type { Clock, Sensitivity } from '../interfaces/index.js';
import type { RawSource, ResourceMetadataGroup } from '../types/index.js';
import {
  SOURCE_OWNED_METADATA_GROUPS_KEY,
  validateResourceMetadataGroups,
} from './resource-metadata-groups.js';
export { emptySourceConfigRegistration } from '../source-registration.js';

const RESERVED_RESOURCE_METADATA_KEYS = new Set([
  'canonicalId',
  'sourceType',
  'dedupKeys',
  'provenances',
  'label',
  SOURCE_OWNED_METADATA_GROUPS_KEY,
  'extractionSnapshot',
]);

function isJsonSafe(value: unknown): boolean {
  if (value === null) return true;
  const valueType = typeof value;
  if (valueType === 'string' || valueType === 'boolean') return true;
  if (valueType === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJsonSafe);
  if (valueType !== 'object') return false;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  return Object.values(value as Record<string, unknown>).every(isJsonSafe);
}

function sanitizeResourceMetadata(
  canonicalId: string,
  metadata: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!metadata) return undefined;
  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (RESERVED_RESOURCE_METADATA_KEYS.has(key) || value === undefined) continue;
    if (!isJsonSafe(value)) {
      throw new Error(`invalid Resource metadata for ${canonicalId}: ${key} is not JSON-safe`);
    }
    sanitized[key] = value;
  }
  return Object.keys(sanitized).length > 0 ? sanitized : undefined;
}

export interface SourceEnvelopeInput<TPayload> {
  readonly canonicalId: string;
  readonly sourceType: string;
  readonly sensitivity: Sensitivity;
  readonly payload: TPayload;
  readonly label: string;
  readonly clock: Clock;
  readonly sourceUri?: string;
  readonly pipelineVersion?: string;
  readonly dedupKeys?: readonly string[];
  readonly resourceMetadata?: Record<string, unknown>;
  readonly resourceMetadataGroups?: readonly ResourceMetadataGroup[];
}

export function createRawSource<TPayload>(input: SourceEnvelopeInput<TPayload>): RawSource<TPayload> {
  const resourceMetadata = sanitizeResourceMetadata(input.canonicalId, input.resourceMetadata);
  const resourceMetadataGroups = validateResourceMetadataGroups(input.resourceMetadataGroups);
  return {
    canonicalId: input.canonicalId,
    ...(input.dedupKeys ? { dedupKeys: [...input.dedupKeys] } : {}),
    sourceType: input.sourceType,
    sensitivity: input.sensitivity,
    provenance: {
      ...(input.sourceUri ? { sourceUri: input.sourceUri } : {}),
      ingestedAt: input.clock.now().toISOString(),
      ...(input.pipelineVersion ? { pipelineVersion: input.pipelineVersion } : {}),
      sourceType: input.sourceType,
    },
    payload: input.payload,
    ...(resourceMetadata ? { resourceMetadata } : {}),
    ...(resourceMetadataGroups ? { resourceMetadataGroups } : {}),
    label: input.label,
  };
}
