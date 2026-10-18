// SPDX-License-Identifier: Apache-2.0
import type { CaptureEvent } from './schema.js';

export function validateCapture(capture: CaptureEvent): void {
  const ids = new Set<string>();
  for (const record of [...capture.activities, ...capture.facts, ...capture.decisions, ...capture.questions]) {
    if (ids.has(record.id)) throw new Error(`Duplicate record ID: ${record.id}`);
    ids.add(record.id);
  }
  const activities = new Map(capture.activities.map(item => [item.id, item]));
  const requireActivity = (id: string) => {
    const activity = activities.get(id);
    if (!activity) throw new Error(`Unknown activity reference: ${id}`);
    return activity;
  };
  const visiting = new Set<string>();
  const visited = new Set<string>();
  function visit(id: string): void {
    if (visiting.has(id)) throw new Error(`Dependency cycle: ${id}`);
    if (visited.has(id)) return;
    visiting.add(id);
    for (const prerequisite of requireActivity(id).prerequisites) visit(prerequisite);
    visiting.delete(id);
    visited.add(id);
  }
  capture.activities.forEach(item => visit(item.id));
  const factKeys = new Set<string>();
  for (const fact of capture.facts) {
    const key = JSON.stringify([fact.activityId, fact.key]);
    if (factKeys.has(key)) throw new Error(`Conflicting fact for ${fact.activityId}: ${fact.key}`);
    factKeys.add(key);
    if (requireActivity(fact.activityId).date !== fact.appliesOn) {
      throw new Error(`Fact date differs from its activity: ${fact.id}`);
    }
  }
  for (const record of [...capture.decisions, ...capture.questions]) {
    record.activityIds.forEach(requireActivity);
  }
}
