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

  return {
    ...existingMetadata,
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
