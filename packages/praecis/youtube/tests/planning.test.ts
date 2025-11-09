import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { InMemoryStore } from '@aidha/graph-backend';
import {
  createArea,
  createGoal,
  createProject,
} from '../src/planning/index.js';

describe('planning helpers', () => {
  let store: InMemoryStore;

  beforeEach(() => {
    store = new InMemoryStore();
  });

  afterEach(async () => {
    await store.close();
  });

  it('creates an Area with deterministic id when no id is provided', async () => {
    const result = await createArea(store, {
      name: 'Health',
      description: 'Maintain baseline health metrics',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.areaId).toBe('area-health');
    expect(result.value.createdArea).toBe(true);

    const node = await store.getNode(result.value.areaId);
    expect(node.ok).toBe(true);
    if (!node.ok) return;
    expect(node.value?.type).toBe('Area');
    expect(node.value?.metadata?.['description']).toBe('Maintain baseline health metrics');
  });

  it('upserts the same Area idempotently', async () => {
    const first = await createArea(store, { name: 'Career' });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const second = await createArea(store, { name: 'Career' });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.value.areaId).toBe(first.value.areaId);
    expect(second.value.createdArea).toBe(false);
  });

  it('uses name-based slug metadata when custom Area id is provided', async () => {
    const result = await createArea(store, {
      id: 'custom-area-id',
      name: 'Health Focus',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const node = await store.getNode('custom-area-id');
    expect(node.ok).toBe(true);
    if (!node.ok) return;
    expect(node.value?.metadata?.['slug']).toBe('health-focus');
  });

  it('creates a Goal and links it to an Area when provided', async () => {
    const area = await createArea(store, { name: 'Finance' });
    expect(area.ok).toBe(true);
    if (!area.ok) return;

    const goal = await createGoal(store, {
      name: 'Build six-month emergency fund',
      areaId: area.value.areaId,
      description: 'Cash reserves for household',
    });
    expect(goal.ok).toBe(true);
    if (!goal.ok) return;
    expect(goal.value.goalId).toBe('goal-build-six-month-emergency-fund');

    const edges = await store.getEdges({
      subject: area.value.areaId,
      predicate: 'relatedTo',
      object: goal.value.goalId,
    });
    expect(edges.ok).toBe(true);
    if (!edges.ok) return;
    expect(edges.value.items.length).toBe(1);
  });

  it('creates a Project and links it to Area and Goal when provided', async () => {
    const area = await createArea(store, { name: 'Health' });
    expect(area.ok).toBe(true);
    if (!area.ok) return;

    const goal = await createGoal(store, { name: 'Lower blood pressure', areaId: area.value.areaId });
    expect(goal.ok).toBe(true);
    if (!goal.ok) return;

    const project = await createProject(store, {
      name: 'Meditation Habit',
      areaId: area.value.areaId,
      goalId: goal.value.goalId,
    });
    expect(project.ok).toBe(true);
    if (!project.ok) return;
    expect(project.value.projectId).toBe('project-meditation-habit');

    const areaEdge = await store.getEdges({
      subject: project.value.projectId,
      predicate: 'projectInArea',
      object: area.value.areaId,
    });
    expect(areaEdge.ok).toBe(true);
    if (areaEdge.ok) expect(areaEdge.value.items.length).toBe(1);

    const goalEdge = await store.getEdges({
      subject: project.value.projectId,
      predicate: 'projectServesGoal',
      object: goal.value.goalId,
    });
    expect(goalEdge.ok).toBe(true);
    if (goalEdge.ok) expect(goalEdge.value.items.length).toBe(1);
  });
});
