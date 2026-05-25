// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 Colin Farmer (GitCmurf)

import { TagAssignment, type TagAssignment as TagAssignmentType } from '@aidha/taxonomy';

export const TAXONOMY_ASSIGNMENTS_METADATA_KEY = 'taxonomyAssignments';

export function readTaxonomyAssignments(metadata: Record<string, unknown>): TagAssignmentType[] {
  const value = metadata[TAXONOMY_ASSIGNMENTS_METADATA_KEY];
  if (!Array.isArray(value)) return [];
  return value.flatMap(entry => {
    const parsed = TagAssignment.safeParse(entry);
    return parsed.success ? [parsed.data] : [];
  });
}

function assignmentKey(assignment: Pick<TagAssignmentType, 'nodeId' | 'tagId'>): string {
  return `${assignment.nodeId}|${assignment.tagId}`;
}

export function withTaxonomyAssignment(
  metadata: Record<string, unknown>,
  assignment: TagAssignmentType,
): Record<string, unknown> {
  const byKey = new Map(readTaxonomyAssignments(metadata).map(item => [assignmentKey(item), item]));
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
  const assignments = readTaxonomyAssignments(next).filter(assignment => !(assignment.nodeId === nodeId && assignment.tagId === tagId));
  if (assignments.length > 0) {
    next[TAXONOMY_ASSIGNMENTS_METADATA_KEY] = assignments;
  } else {
    delete next[TAXONOMY_ASSIGNMENTS_METADATA_KEY];
  }
  return next;
}
