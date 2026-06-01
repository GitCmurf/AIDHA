import type { GraphNode, GraphStore, NodeDataInput } from '@aidha/graph-backend';
import type { Result } from '../pipeline/types.js';
import {
  createActivationTaskFromClaim,
  DEFAULT_INBOX_PROJECT_ID,
  getActivationTaskContext,
  hashId,
} from '@aidha/praecis-core';

export { DEFAULT_INBOX_PROJECT_ID } from '@aidha/praecis-core';

export interface TaskCreateInput {
  claimId: string;
  title?: string;
  projectId?: string;
  tags?: string[];
}

export interface TaskCreateResult {
  taskId: string;
  projectId: string;
  createdProject: boolean;
  createdTask: boolean;
}

export interface StandaloneTaskCreateInput {
  title: string;
  projectId?: string;
  tags?: string[];
}

export interface TaskClaimContext {
  claimId: string;
  claimText: string;
  excerptText?: string;
  timestampSeconds?: number;
  timestampLabel?: string;
  timestampUrl?: string;
  resourceTitle?: string;
  resourceUrl?: string;
}

export interface TaskContext {
  task: GraphNode;
  project?: GraphNode;
  claims: TaskClaimContext[];
  tags: GraphNode[];
}

function normalizeProjectId(projectId?: string): string {
  if (!projectId || projectId.trim().length === 0) return DEFAULT_INBOX_PROJECT_ID;
  if (projectId.trim().toLowerCase() === 'inbox') return DEFAULT_INBOX_PROJECT_ID;
  return projectId.trim();
}

function normalizeTagId(tag: string): string {
  const slug = tag.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return slug.length > 0 ? `tag-${slug}` : hashId('tag', [tag]);
}

async function ensureProject(store: GraphStore, projectId: string): Promise<Result<{ node: GraphNode; created: boolean }>> {
  const existing = await store.getNode(projectId);
  if (!existing.ok) return existing;
  if (existing.value) return { ok: true, value: { node: existing.value, created: false } };

  const isInbox = projectId === DEFAULT_INBOX_PROJECT_ID;
  const data: NodeDataInput = {
    label: isInbox ? 'Inbox' : projectId,
    metadata: {
      slug: isInbox ? 'inbox' : projectId,
      default: isInbox,
    },
  };
  const upsert = await store.upsertNode('Project', projectId, data, { detectNoop: true });
  if (!upsert.ok) return upsert;
  const created = upsert.value.created;
  const nodeResult = await store.getNode(projectId);
  if (!nodeResult.ok) return nodeResult;
  if (!nodeResult.value) {
    return { ok: false, error: new Error(`Project not found after upsert: ${projectId}`) };
  }
  return { ok: true, value: { node: nodeResult.value, created } };
}

async function ensureTag(store: GraphStore, tag: string): Promise<Result<GraphNode>> {
  const tagId = normalizeTagId(tag);
  const existing = await store.getNode(tagId);
  if (!existing.ok) return existing;
  if (existing.value) return { ok: true, value: existing.value };
  const data: NodeDataInput = {
    label: tag.trim(),
    metadata: {
      slug: tagId.replace(/^tag-/, ''),
    },
  };
  const upsert = await store.upsertNode('TopicTag', tagId, data, { detectNoop: true });
  if (!upsert.ok) return upsert;
  const nodeResult = await store.getNode(tagId);
  if (!nodeResult.ok) return nodeResult;
  if (!nodeResult.value) {
    return { ok: false, error: new Error(`TopicTag not found after upsert: ${tagId}`) };
  }
  return { ok: true, value: nodeResult.value };
}

export async function createTaskFromClaim(
  store: GraphStore,
  input: TaskCreateInput
): Promise<Result<TaskCreateResult>> {
  return createActivationTaskFromClaim(store, input);
}

export async function createTaskStandalone(
  store: GraphStore,
  input: StandaloneTaskCreateInput
): Promise<Result<TaskCreateResult>> {
  const title = input.title.trim();
  if (!title) {
    return { ok: false, error: new Error('Task title is required.') };
  }
  const projectId = normalizeProjectId(input.projectId);
  const projectResult = await ensureProject(store, projectId);
  if (!projectResult.ok) return projectResult;

  const taskId = hashId('task', [projectId, title]);
  const taskData: NodeDataInput = {
    label: title,
    content: title,
    metadata: {
      projectId,
      status: 'open',
      source: 'manual',
    },
  };
  const taskUpsert = await store.upsertNode('Task', taskId, taskData, { detectNoop: true });
  if (!taskUpsert.ok) return taskUpsert;

  const edge = await store.upsertEdge(
    taskId,
    'taskPartOfProject',
    projectId,
    { metadata: {} },
    { detectNoop: true }
  );
  if (!edge.ok) return edge;

  for (const tag of input.tags ?? []) {
    if (!tag.trim()) continue;
    const tagResult = await ensureTag(store, tag);
    if (!tagResult.ok) return tagResult;
    const about = await store.upsertEdge(
      taskId,
      'aboutTag',
      tagResult.value.id,
      { metadata: {} },
      { detectNoop: true }
    );
    if (!about.ok) return about;
  }

  return {
    ok: true,
    value: {
      taskId,
      projectId,
      createdProject: projectResult.value.created,
      createdTask: taskUpsert.value.created,
    },
  };
}

export async function getTaskContext(store: GraphStore, taskId: string): Promise<Result<TaskContext>> {
  const context = await getActivationTaskContext(store, taskId);
  if (!context.ok) return context;
  const claims: TaskClaimContext[] = context.value.claims.map(claim => {
    const timecode = claim.locator?.kind === 'timecode' ? claim.locator : undefined;
    return {
      claimId: claim.claimId,
      claimText: claim.claimText,
      excerptText: claim.excerptText,
      timestampSeconds: timecode?.startSec,
      timestampLabel: timecode ? claim.locatorDisplay?.label : undefined,
      timestampUrl: timecode ? claim.locatorDisplay?.url : undefined,
      resourceTitle: claim.resourceTitle,
      resourceUrl: claim.locatorDisplay?.url,
    };
  });

  return {
    ok: true,
    value: {
      task: context.value.task,
      project: context.value.project,
      claims,
      tags: context.value.tags,
    },
  };
}

export function formatTaskContext(context: TaskContext): string {
  const lines: string[] = [];
  lines.push(`Task: ${context.task.label} (${context.task.id})`);
  if (context.project) {
    lines.push(`Project: ${context.project.label} (${context.project.id})`);
  }
  if (context.tags.length > 0) {
    const tagLabels = context.tags.map(tag => tag.label).join(', ');
    lines.push(`Tags: ${tagLabels}`);
  }
  lines.push('Claims:');
  if (context.claims.length === 0) {
    lines.push('- None');
  } else {
    for (const claim of context.claims) {
      const timestamp = claim.timestampLabel ? `[${claim.timestampLabel}] ` : '';
      lines.push(`- ${timestamp}${claim.claimText}`);
      if (claim.timestampUrl) {
        lines.push(`  ${claim.timestampUrl}`);
      }
      if (claim.excerptText) {
        lines.push(`  Excerpt: ${claim.excerptText}`);
      }
      if (claim.resourceTitle) {
        lines.push(`  Source: ${claim.resourceTitle}`);
      }
    }
  }
  return lines.join('\n');
}

export function normalizeProjectIdForCli(value?: string): string | undefined {
  if (!value) return undefined;
  return normalizeProjectId(value);
}
