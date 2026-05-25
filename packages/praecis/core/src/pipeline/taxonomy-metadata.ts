// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 Colin Farmer (GitCmurf)

import { TagAssignment, type Result, type TagAssignment as TagAssignmentType } from '@aidha/taxonomy';

export const TAXONOMY_ASSIGNMENTS_METADATA_KEY = 'taxonomyAssignments';

export function readTaxonomyAssignmentsResult(metadata: Record<string, unknown>): Result<TagAssignmentType[]> {
  const value = metadata[TAXONOMY_ASSIGNMENTS_METADATA_KEY];
  if (value === undefined) return { ok: true, value: [] };
  if (!Array.isArray(value)) {
    return {
      ok: false,
      error: new Error('Invalid taxonomyAssignments metadata: expected array'),
    };
  }
  const assignments: TagAssignmentType[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const parsed = TagAssignment.safeParse(value[index]);
    if (!parsed.success) {
      return {
        ok: false,
        error: new Error(`Invalid taxonomyAssignments metadata at index ${index}: ${parsed.error.message}`),
      };
    }
    assignments.push(parsed.data);
  }
  return { ok: true, value: assignments };
}

export function readTaxonomyAssignments(metadata: Record<string, unknown>): TagAssignmentType[] {
  const assignments = readTaxonomyAssignmentsResult(metadata);
  if (!assignments.ok) return [];
  return assignments.value;
}

function assignmentKey(assignment: Pick<TagAssignmentType, 'nodeId' | 'tagId'>): string {
  return `${assignment.nodeId}|${assignment.tagId}`;
}

export function withTaxonomyAssignment(
  metadata: Record<string, unknown>,
  assignment: TagAssignmentType,
): Record<string, unknown> {
  const existing = readTaxonomyAssignmentsResult(metadata);
  if (!existing.ok) throw existing.error;
  const byKey = new Map(existing.value.map(item => [assignmentKey(item), item]));
  byKey.set(assignmentKey(assignment), assignment);
  return {
    ...metadata,
    [TAXONOMY_ASSIGNMENTS_METADATA_KEY]: Array.from(byKey.values()).sort((a, b) => a.tagId.localeCompare(b.tagId)),
  };
}

export function withoutTaxonomyAssignment(
  metadata: Record<string, unknown>,
  nodeId: string,
  tagId: string,
): Record<string, unknown> {
  const next = { ...metadata };
  const existing = readTaxonomyAssignmentsResult(next);
  if (!existing.ok) throw existing.error;
  const assignments = existing.value.filter(assignment => !(assignment.nodeId === nodeId && assignment.tagId === tagId));
  if (assignments.length > 0) {
    next[TAXONOMY_ASSIGNMENTS_METADATA_KEY] = assignments;
  } else {
    delete next[TAXONOMY_ASSIGNMENTS_METADATA_KEY];
  }
  return next;
}
