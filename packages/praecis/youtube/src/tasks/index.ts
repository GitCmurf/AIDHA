import type { GraphNode, GraphStore, NodeDataInput } from '@aidha/graph-backend';
import type { Result } from '../pipeline/types.js';
import { hashId } from '../utils/ids.js';
import { buildTimestampUrl, formatTimestamp, toNumber } from '../extract/utils.js';

export const DEFAULT_INBOX_PROJECT_ID = 'project-inbox';

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

function truncate(text: string | undefined, max = 220): string | undefined {
  if (!text) return undefined;
  const trimmed = text.replace(/\s+/g, ' ').trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max - 1)}…`;
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
  const claimResult = await store.getNode(input.claimId);
  if (!claimResult.ok) return claimResult;
  if (!claimResult.value) {
    return { ok: false, error: new Error(`Claim not found: ${input.claimId}`) };
  }
  if (claimResult.value.type !== 'Claim') {
    return { ok: false, error: new Error(`Node is not a Claim: ${input.claimId}`) };
  }

  const projectId = normalizeProjectId(input.projectId);
  const projectResult = await ensureProject(store, projectId);
  if (!projectResult.ok) return projectResult;

  const title = input.title?.trim().length ? input.title.trim() : claimResult.value.label;
  const taskId = hashId('task', [projectId, input.claimId, title]);

  const taskData: NodeDataInput = {
    label: title,
    content: title,
    metadata: {
      projectId,
      sourceClaimId: input.claimId,
      status: 'open',
    },
  };
  const taskUpsert = await store.upsertNode('Task', taskId, taskData, { detectNoop: true });
  if (!taskUpsert.ok) return taskUpsert;

  const edge1 = await store.upsertEdge(
    taskId,
    'taskMotivatedBy',
    input.claimId,
    { metadata: {} },
    { detectNoop: true }
  );
  if (!edge1.ok) return edge1;

  const edge2 = await store.upsertEdge(
    taskId,
    'taskPartOfProject',
    projectId,
    { metadata: {} },
    { detectNoop: true }
  );
  if (!edge2.ok) return edge2;

  const tags = input.tags ?? [];
  for (const tag of tags) {
    if (!tag.trim()) continue;
    const tagResult = await ensureTag(store, tag);
    if (!tagResult.ok) return tagResult;
    const edge = await store.upsertEdge(
      taskId,
      'aboutTag',
      tagResult.value.id,
      { metadata: {} },
      { detectNoop: true }
    );
    if (!edge.ok) return edge;
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
  const taskResult = await store.getNode(taskId);
  if (!taskResult.ok) return taskResult;
  if (!taskResult.value) {
    return { ok: false, error: new Error(`Task not found: ${taskId}`) };
  }

  const projectEdge = await store.getEdges({ predicate: 'taskPartOfProject', subject: taskId });
  if (!projectEdge.ok) return projectEdge;
  const projectId = projectEdge.value.items[0]?.object;
  const projectResult: Result<GraphNode | null> = projectId
    ? await store.getNode(projectId)
    : { ok: true, value: null };
  if (!projectResult.ok) return projectResult;

  const tagEdges = await store.getEdges({ predicate: 'aboutTag', subject: taskId });
  if (!tagEdges.ok) return tagEdges;
  const tags: GraphNode[] = [];
  for (const edge of tagEdges.value.items) {
    const tagResult = await store.getNode(edge.object);
    if (!tagResult.ok) return tagResult;
    if (tagResult.value) tags.push(tagResult.value);
  }

  const claimEdges = await store.getEdges({ predicate: 'taskMotivatedBy', subject: taskId });
  if (!claimEdges.ok) return claimEdges;

  const claims: TaskClaimContext[] = [];
  for (const edge of claimEdges.value.items) {
    const claimResult = await store.getNode(edge.object);
    if (!claimResult.ok) return claimResult;
    if (!claimResult.value) continue;
    const claim = claimResult.value;

    const excerptEdges = await store.getEdges({ predicate: 'claimDerivedFrom', subject: claim.id });
    if (!excerptEdges.ok) return excerptEdges;
    const excerpts: GraphNode[] = [];
    for (const excerptEdge of excerptEdges.value.items) {
      const excerptResult = await store.getNode(excerptEdge.object);
      if (!excerptResult.ok) return excerptResult;
      if (excerptResult.value) excerpts.push(excerptResult.value);
    }
    const excerpt = excerpts.sort((a, b) => {
      const aStart = toNumber(a.metadata?.['start'], 0);
      const bStart = toNumber(b.metadata?.['start'], 0);
      if (aStart !== bStart) return aStart - bStart;
      return a.id.localeCompare(b.id);
    })[0];

    const resourceId = claim.metadata?.['resourceId'] as string | undefined;
    const resourceResult: Result<GraphNode | null> = resourceId
      ? await store.getNode(resourceId)
      : { ok: true, value: null };
    if (!resourceResult.ok) return resourceResult;
    const resource = resourceResult.value ?? undefined;

    const startSeconds = excerpt ? toNumber(excerpt.metadata?.['start'], 0) : undefined;
    const baseUrl = (resource?.metadata?.['url'] as string | undefined) ??
      (resourceId ? `https://www.youtube.com/watch?v=${resourceId.replace('youtube-', '')}` : '');
    const timestampUrl = baseUrl && typeof startSeconds === 'number'
      ? buildTimestampUrl(baseUrl, startSeconds)
      : undefined;

    claims.push({
      claimId: claim.id,
      claimText: (claim.content ?? claim.label).trim(),
      excerptText: truncate(excerpt?.content),
      timestampSeconds: startSeconds,
      timestampLabel: typeof startSeconds === 'number' ? formatTimestamp(startSeconds) : undefined,
      timestampUrl,
      resourceTitle: resource?.label,
      resourceUrl: baseUrl || undefined,
    });
  }

  return {
    ok: true,
    value: {
      task: taskResult.value,
      project: projectResult.value ?? undefined,
      claims,
      tags,
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
