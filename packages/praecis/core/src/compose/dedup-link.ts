// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 Colin Farmer (GitCmurf)

import type { GraphNode, GraphStore } from '@aidha/graph-backend';
import type { Result } from '@aidha/taxonomy';
import type { RawSource } from '../types/index.js';
import { DedupResolver, type DedupAction } from './dedup-resolver.js';

export interface DedupLinkResult {
  readonly action: DedupAction;
  readonly resourceId: string;
  readonly matchedKey?: string;
  readonly edgeCreated: boolean;
}

function uniqueStrings(values: readonly string[] = []): string[] {
  return Array.from(new Set(values.filter((value): value is string => typeof value === 'string' && value.length > 0)));
}

function uniqueProvenances(existing: readonly unknown[] = [], incoming: readonly unknown[] = []): unknown[] {
  const seen = new Set<string>();
  const merged: unknown[] = [];

  for (const provenance of [...existing, ...incoming]) {
    const key = provenance !== null && typeof provenance === 'object'
      ? JSON.stringify(provenance, Object.keys(provenance as Record<string, unknown>).sort())
      : JSON.stringify(provenance);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(provenance);
  }

  return merged;
}

const RESERVED_RESOURCE_METADATA_KEYS = new Set([
  'canonicalId',
  'sourceType',
  'dedupKeys',
  'provenances',
  'label',
]);

interface MetadataConflict {
  readonly key: string;
  readonly existing: unknown;
  readonly incoming: unknown;
  readonly incomingCanonicalId: string;
  readonly incomingSourceType: string;
}

function isJsonSafe(value: unknown): boolean {
  if (value === null) return true;
  const valueType = typeof value;
  if (valueType === 'string' || valueType === 'boolean') return true;
  if (valueType === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJsonSafe);
  if (valueType !== 'object') return false;
  return Object.values(value as Record<string, unknown>).every(isJsonSafe);
}

function valuesEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function existingConflicts(metadata: Record<string, unknown>): MetadataConflict[] {
  const conflicts = metadata['metadataConflicts'];
  if (!Array.isArray(conflicts)) return [];
  return conflicts.filter((conflict): conflict is MetadataConflict => (
    conflict !== null
    && typeof conflict === 'object'
    && typeof (conflict as Record<string, unknown>)['key'] === 'string'
  ));
}

function uniqueConflicts(conflicts: readonly MetadataConflict[]): MetadataConflict[] {
  const seen = new Set<string>();
  const unique: MetadataConflict[] = [];
  for (const conflict of conflicts) {
    const key = JSON.stringify(conflict);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(conflict);
  }
  return unique;
}

export function mergeResourceMetadata(
  existingMetadata: Record<string, unknown>,
  source: RawSource,
  options: { readonly sameCanonical: boolean },
): Record<string, unknown> {
  const incoming = source.resourceMetadata ?? {};
  const merged: Record<string, unknown> = { ...existingMetadata };
  const conflicts = existingConflicts(existingMetadata);

  for (const [key, value] of Object.entries(incoming)) {
    if (RESERVED_RESOURCE_METADATA_KEYS.has(key)) continue;
    if (value === undefined) continue;
    if (!isJsonSafe(value)) {
      throw new Error(`invalid Resource metadata for ${source.canonicalId}: ${key} is not JSON-safe`);
    }

    const existingValue = merged[key];
    if (existingValue === undefined || options.sameCanonical || valuesEqual(existingValue, value)) {
      merged[key] = value;
      continue;
    }

    conflicts.push({
      key,
      existing: existingValue,
      incoming: value,
      incomingCanonicalId: source.canonicalId,
      incomingSourceType: source.sourceType,
    });
  }

  const unique = uniqueConflicts(conflicts);
  if (unique.length > 0) {
    merged['metadataConflicts'] = unique;
  } else {
    delete merged['metadataConflicts'];
  }

  return merged;
}

function resourceMetadata(node: GraphNode | null | undefined, source: RawSource) {
  const existingMetadata = (node?.metadata ?? {}) as Record<string, unknown>;
  const existingDedupKeys = Array.isArray(existingMetadata['dedupKeys'])
    ? existingMetadata['dedupKeys'].filter((value): value is string => typeof value === 'string')
    : [];
  const existingProvenances = Array.isArray(existingMetadata['provenances'])
    ? existingMetadata['provenances']
    : [];

  const dedupKeys = uniqueStrings([
    node?.id ?? source.canonicalId,
    source.canonicalId,
    ...(source.dedupKeys ?? []),
    ...existingDedupKeys,
  ]);

  const metadata = mergeResourceMetadata(existingMetadata, source, {
    sameCanonical: !node || node.id === source.canonicalId,
  });

  return {
    ...metadata,
    canonicalId: existingMetadata['canonicalId'] ?? node?.id ?? source.canonicalId,
    sourceType: existingMetadata['sourceType'] ?? source.sourceType,
    dedupKeys,
    provenances: uniqueProvenances(existingProvenances, [source.provenance]),
    label: node?.label ?? source.label,
  };
}

async function upsertResource(
  store: GraphStore,
  resourceId: string,
  source: RawSource,
  existingNode?: GraphNode | null,
): Promise<Result<GraphNode>> {
  const result = await store.upsertNode(
    'Resource',
    resourceId,
    {
      label: existingNode?.label ?? source.label ?? resourceId,
      content: existingNode?.content,
      metadata: resourceMetadata(existingNode, source),
    },
    { detectNoop: true },
  );
  if (!result.ok) return result;
  return { ok: true, value: result.value.node };
}

export async function applyDedupResolution(
  store: GraphStore,
  source: RawSource,
): Promise<Result<DedupLinkResult>> {
  const resolver = new DedupResolver(store);
  const resolution = await resolver.resolve(source);
  if (!resolution.ok) return resolution;

  if (resolution.value.action === 'create') {
    const created = await upsertResource(store, source.canonicalId, source, null);
    if (!created.ok) return created;
    return {
      ok: true,
      value: {
        action: 'create',
        resourceId: created.value.id,
        edgeCreated: false,
      },
    };
  }

  const matchedNode = resolution.value.matchedNode;
  if (!matchedNode) {
    return { ok: false, error: new Error('dedup resolution returned a match without a node') };
  }

  if (resolution.value.action === 'merge') {
    const merged = await upsertResource(store, matchedNode.id, source, matchedNode);
    if (!merged.ok) return merged;

    let edgeCreated = false;
    if (source.canonicalId !== matchedNode.id) {
      const edge = await store.upsertEdge(
        matchedNode.id,
        'alsoSeenVia',
        source.canonicalId,
        {
          metadata: {
            sourceType: source.sourceType,
            sourceUri: source.provenance.sourceUri,
          },
        },
        { detectNoop: true },
      );
      if (!edge.ok) return edge;
      edgeCreated = !edge.value.noop;
    }

    return {
      ok: true,
      value: {
        action: 'merge',
        resourceId: merged.value.id,
        matchedKey: resolution.value.matchedKey,
        edgeCreated,
      },
    };
  }

  const created = await upsertResource(store, source.canonicalId, source, null);
  if (!created.ok) return created;

  const edge = await store.upsertEdge(
    created.value.id,
    'corroboratedBy',
    matchedNode.id,
    {
      metadata: {
        sourceType: source.sourceType,
        sourceUri: source.provenance.sourceUri,
      },
    },
    { detectNoop: true },
  );
  if (!edge.ok) return edge;

  return {
    ok: true,
    value: {
      action: 'corroborate',
      resourceId: created.value.id,
      matchedKey: resolution.value.matchedKey,
      edgeCreated: !edge.value.noop,
    },
  };
}
