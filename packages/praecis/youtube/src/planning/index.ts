import type { GraphStore, NodeDataInput } from '@aidha/graph-backend';
import type { Result } from '../pipeline/types.js';
import { hashId } from '../utils/ids.js';

function normalizeSlug(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function normalizeAreaId(input?: string, name?: string): string {
  if (input && input.trim()) return input.trim();
  const slug = name ? normalizeSlug(name) : '';
  if (slug) return `area-${slug}`;
  return hashId('area', [name ?? '']);
}

function normalizeGoalId(input?: string, name?: string): string {
  if (input && input.trim()) return input.trim();
  const slug = name ? normalizeSlug(name) : '';
  if (slug) return `goal-${slug}`;
  return hashId('goal', [name ?? '']);
}

function normalizeProjectId(input?: string, name?: string): string {
  if (input && input.trim()) return input.trim();
  const slug = name ? normalizeSlug(name) : '';
  if (slug) return `project-${slug}`;
  return hashId('project', [name ?? '']);
}

function deriveSlugFromId(prefix: string, id: string, name: string): string {
  const expectedPrefix = `${prefix}-`;
  if (id.startsWith(expectedPrefix)) {
    return id.slice(expectedPrefix.length);
  }
  return normalizeSlug(name);
}

export interface AreaCreateInput {
  id?: string;
  name: string;
  description?: string;
}

export interface AreaCreateResult {
  areaId: string;
  createdArea: boolean;
}

export interface GoalCreateInput {
  id?: string;
  name: string;
  description?: string;
  areaId?: string;
}

export interface GoalCreateResult {
  goalId: string;
  createdGoal: boolean;
  linkedArea: boolean;
}

export interface ProjectCreateInput {
  id?: string;
  name: string;
  description?: string;
  areaId?: string;
  goalId?: string;
}

export interface ProjectCreateResult {
  projectId: string;
  createdProject: boolean;
  linkedArea: boolean;
  linkedGoal: boolean;
}

export async function createArea(
  store: GraphStore,
  input: AreaCreateInput
): Promise<Result<AreaCreateResult>> {
  const name = input.name.trim();
  if (!name) return { ok: false, error: new Error('Area name is required.') };

  const areaId = normalizeAreaId(input.id, name);
  const metadata: Record<string, unknown> = {};
  if (input.description?.trim()) metadata['description'] = input.description.trim();
  metadata['slug'] = deriveSlugFromId('area', areaId, name);

  const data: NodeDataInput = {
    label: name,
    content: input.description?.trim() || undefined,
    metadata,
  };

  const upsert = await store.upsertNode('Area', areaId, data, { detectNoop: true });
  if (!upsert.ok) return upsert;

  return {
    ok: true,
    value: {
      areaId,
      createdArea: upsert.value.created,
    },
  };
}

export async function createGoal(
  store: GraphStore,
  input: GoalCreateInput
): Promise<Result<GoalCreateResult>> {
  const name = input.name.trim();
  if (!name) return { ok: false, error: new Error('Goal name is required.') };

  const goalId = normalizeGoalId(input.id, name);
  const metadata: Record<string, unknown> = {};
  if (input.description?.trim()) metadata['description'] = input.description.trim();
  metadata['slug'] = deriveSlugFromId('goal', goalId, name);
  if (input.areaId?.trim()) metadata['areaId'] = input.areaId.trim();

  const data: NodeDataInput = {
    label: name,
    content: input.description?.trim() || undefined,
    metadata,
  };

  const upsert = await store.upsertNode('Goal', goalId, data, { detectNoop: true });
  if (!upsert.ok) return upsert;

  let linkedArea = false;
  if (input.areaId?.trim()) {
    const areaId = input.areaId.trim();
    const areaNode = await store.getNode(areaId);
    if (!areaNode.ok) return areaNode;
    if (!areaNode.value || areaNode.value.type !== 'Area') {
      return { ok: false, error: new Error(`Area not found: ${areaId}`) };
    }
    const edge = await store.upsertEdge(areaId, 'relatedTo', goalId, { metadata: {} }, { detectNoop: true });
    if (!edge.ok) return edge;
    linkedArea = true;
  }

  return {
    ok: true,
    value: {
      goalId,
      createdGoal: upsert.value.created,
      linkedArea,
    },
  };
}

export async function createProject(
  store: GraphStore,
  input: ProjectCreateInput
): Promise<Result<ProjectCreateResult>> {
  const name = input.name.trim();
  if (!name) return { ok: false, error: new Error('Project name is required.') };

  const projectId = normalizeProjectId(input.id, name);
  const metadata: Record<string, unknown> = {};
  if (input.description?.trim()) metadata['description'] = input.description.trim();
  metadata['slug'] = deriveSlugFromId('project', projectId, name);
  if (input.areaId?.trim()) metadata['areaId'] = input.areaId.trim();
  if (input.goalId?.trim()) metadata['goalId'] = input.goalId.trim();

  const data: NodeDataInput = {
    label: name,
    content: input.description?.trim() || undefined,
    metadata,
  };

  const upsert = await store.upsertNode('Project', projectId, data, { detectNoop: true });
  if (!upsert.ok) return upsert;

  let linkedArea = false;
  if (input.areaId?.trim()) {
    const areaId = input.areaId.trim();
    const areaNode = await store.getNode(areaId);
    if (!areaNode.ok) return areaNode;
    if (!areaNode.value || areaNode.value.type !== 'Area') {
      return { ok: false, error: new Error(`Area not found: ${areaId}`) };
    }
    const areaEdge = await store.upsertEdge(
      projectId,
      'projectInArea',
      areaId,
      { metadata: {} },
      { detectNoop: true }
    );
    if (!areaEdge.ok) return areaEdge;
    linkedArea = true;
  }

  let linkedGoal = false;
  if (input.goalId?.trim()) {
    const goalId = input.goalId.trim();
    const goalNode = await store.getNode(goalId);
    if (!goalNode.ok) return goalNode;
    if (!goalNode.value || goalNode.value.type !== 'Goal') {
      return { ok: false, error: new Error(`Goal not found: ${goalId}`) };
    }
    const goalEdge = await store.upsertEdge(
      projectId,
      'projectServesGoal',
      goalId,
      { metadata: {} },
      { detectNoop: true }
    );
    if (!goalEdge.ok) return goalEdge;
    linkedGoal = true;
  }

  return {
    ok: true,
    value: {
      projectId,
      createdProject: upsert.value.created,
      linkedArea,
      linkedGoal,
    },
  };
}
