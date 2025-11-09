// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 Colin Farmer (GitCmurf)

import type { GraphNode, GraphEdge } from '../schema/index.js';
import type { NodeSortField, EdgeSortField, SortOption } from './types.js';

export function nowIso(): string {
  return new Date().toISOString();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(normalizeValue);
  }
  if (isRecord(value)) {
    const keys = Object.keys(value).sort();
    const normalized: Record<string, unknown> = {};
    for (const key of keys) {
      normalized[key] = normalizeValue(value[key]);
    }
    return normalized;
  }
  return value;
}

export function stableStringify(value: unknown): string {
  return JSON.stringify(normalizeValue(value));
}

export function deepEqual(a: unknown, b: unknown): boolean {
  return stableStringify(a) === stableStringify(b);
}

export function nodeMatchesFilters(node: GraphNode, filters?: Record<string, unknown>): boolean {
  if (!filters) return true;
  for (const [key, value] of Object.entries(filters)) {
    if (key in node) {
      const nodeValue = (node as Record<string, unknown>)[key];
      if (!deepEqual(nodeValue, value)) return false;
      continue;
    }
    if (node.metadata && key in node.metadata) {
      const metadataValue = (node.metadata as Record<string, unknown>)[key];
      if (!deepEqual(metadataValue, value)) return false;
      continue;
    }
    return false;
  }
  return true;
}

function compareValues(a: unknown, b: unknown): number {
  if (a === b) return 0;
  const aIsNull = a === null;
  const bIsNull = b === null;
  const aIsUndefined = a === undefined;
  const bIsUndefined = b === undefined;
  if (aIsNull || aIsUndefined || bIsNull || bIsUndefined) {
    if ((aIsNull && bIsNull) || (aIsUndefined && bIsUndefined)) return 0;
    if (aIsNull && bIsUndefined) return -1;
    if (aIsUndefined && bIsNull) return 1;
    if (aIsNull || aIsUndefined) return -1;
    if (bIsNull || bIsUndefined) return 1;
  }
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b));
}

function applyDirection(result: number, direction: 'asc' | 'desc'): number {
  return direction === 'desc' ? -result : result;
}

export function sortNodes(nodes: GraphNode[], sort?: SortOption<NodeSortField>): GraphNode[] {
  const direction = sort?.direction ?? 'asc';
  const field = sort?.field;
  return nodes.slice().sort((a, b) => {
    if (field) {
      const primary = applyDirection(compareValues(a[field], b[field]), direction);
      if (primary !== 0) return primary;
    }
    const typeCompare = compareValues(a.type, b.type);
    if (typeCompare !== 0) return typeCompare;
    return compareValues(a.id, b.id);
  });
}

export function sortEdges(edges: GraphEdge[], sort?: SortOption<EdgeSortField>): GraphEdge[] {
  const direction = sort?.direction ?? 'asc';
  const field = sort?.field;
  return edges.slice().sort((a, b) => {
    if (field) {
      const primary = applyDirection(compareValues(a[field], b[field]), direction);
      if (primary !== 0) return primary;
    }
    const subjectCompare = compareValues(a.subject, b.subject);
    if (subjectCompare !== 0) return subjectCompare;
    const predicateCompare = compareValues(a.predicate, b.predicate);
    if (predicateCompare !== 0) return predicateCompare;
    return compareValues(a.object, b.object);
  });
}

export function nodeCursorKey(node: GraphNode): string {
  return `${node.type}|${node.id}`;
}

export function edgeCursorKey(edge: GraphEdge): string {
  return `${edge.subject}|${edge.predicate}|${edge.object}`;
}

export function applyCursorAndLimit<T>(
  items: T[],
  cursor: string | undefined,
  limit: number | undefined,
  keyFn: (item: T) => string
): { items: T[]; nextCursor?: string } {
  let startIndex = 0;
  if (cursor) {
    if (cursor.includes('|')) {
      const idx = items.findIndex(item => keyFn(item) === cursor);
      startIndex = idx >= 0 ? idx + 1 : 0;
    } else {
      const parsed = Number.parseInt(cursor, 10);
      startIndex = Number.isNaN(parsed) ? 0 : Math.max(parsed, 0);
    }
  }
  const remaining = items.slice(startIndex);
  if (limit === undefined) {
    return { items: remaining, nextCursor: undefined };
  }
  const limited = remaining.slice(0, limit);
  const hasMore = remaining.length > limit;
  const nextCursor = hasMore && limited.length > 0 ? keyFn(limited[limited.length - 1] as T) : undefined;
  return { items: limited, nextCursor };
}
