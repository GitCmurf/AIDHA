// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 Colin Farmer (GitCmurf)

import { createHash } from 'node:crypto';
import type { GraphNode, GraphStore, NodeDataInput, Predicate, Result } from '@aidha/graph-backend';
import { Predicate as PredicateSchema } from '@aidha/graph-backend';
import type { Locator } from '../types/index.js';
import { buildTimestampUrl, formatTimestamp } from '../extract/index.js';
import { toNumber } from '../utils/index.js';

export const DEFAULT_INBOX_PROJECT_ID = 'project-inbox';

export type ClaimState = 'draft' | 'accepted' | 'rejected';
export type RoutingReviewStatus = 'unreviewed' | 'confirmed' | 'needs_revision' | 'rejected';

export interface LocatorDisplay {
  label: string;
  url?: string;
}

export interface ActivationClaimHit {
  claimId: string;
  claimText: string;
  claimState: ClaimState;
  resourceId: string;
  resourceTitle: string;
  sourceType?: string;
  excerptId?: string;
  excerptText?: string;
  locator?: Locator;
  locatorDisplay?: LocatorDisplay;
  score: number;
  routingReviewStatus?: RoutingReviewStatus;
  routingReviewReason?: string;
  reviewPriority?: ReviewPriority;
}

export interface ActivationSearchOptions {
  query: string;
  limit?: number;
  projectId?: string;
  source?: string;
  states?: ClaimState[];
}

export interface CreateTaskFromClaimInput {
  claimId: string;
  title?: string;
  projectId?: string;
  tags?: readonly string[];
}

export interface CreateTaskResult {
  taskId: string;
  projectId: string;
  createdProject: boolean;
  createdTask: boolean;
}

export interface TaskClaimContext {
  claimId: string;
  claimText: string;
  resourceId?: string;
  resourceTitle?: string;
  excerptId?: string;
  excerptText?: string;
  locator?: Locator;
  locatorDisplay?: LocatorDisplay;
}

export interface TaskContext {
  task: GraphNode;
  project?: GraphNode;
  claims: TaskClaimContext[];
  tags: GraphNode[];
}

export interface ReviewQueueOptions {
  projectId?: string;
  source?: string;
  limit?: number;
  states?: ClaimState[];
  includeRouting?: boolean;
}

export interface ReviewQueueItem extends ActivationClaimHit {
  reviewAxes: Array<'editorial' | 'routing'>;
}

export interface ReviewPriority {
  score: number;
  reasons: string[];
  summary: string;
}

export interface ProjectReentryDossier {
  project: { id: string; label: string };
  claims: ActivationClaimHit[];
  tasks: TaskContext[];
  blockers: Array<{ taskId: string; taskLabel: string; blockedByTaskId: string; blockedByTaskLabel: string }>;
  reviewItems: ReviewQueueItem[];
  suggestedNextActions: string[];
  provenance: Array<{ claimId: string; excerptId?: string; resourceId: string; resourceTitle: string; locator?: LocatorDisplay }>;
}

interface FtsCapableStore extends GraphStore {
  supportsFts(): boolean;
  searchText(query: string, types?: string[]): Result<Set<string>>;
}

function ok<T>(value: T): Result<T> {
  return { ok: true, value };
}

function normalize(text: unknown): string {
  return typeof text === 'string' ? text.toLowerCase() : '';
}

function compact(text: string | undefined, max = 220): string | undefined {
  if (!text) return undefined;
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, max - 1)}…`;
}

function stableHash(prefix: string, parts: readonly string[]): string {
  return `${prefix}-${createHash('sha256').update(parts.join('\0')).digest('hex').slice(0, 16)}`;
}

function normalizeClaimState(value: unknown): ClaimState {
  return value === 'draft' || value === 'rejected' || value === 'accepted' ? value : 'accepted';
}

function normalizeRoutingStatus(value: unknown): RoutingReviewStatus | undefined {
  if (value === 'unreviewed' || value === 'confirmed' || value === 'needs_revision' || value === 'rejected') {
    return value;
  }
  return undefined;
}

function metadata(node: GraphNode | undefined): Record<string, unknown> {
  return (node?.metadata ?? {}) as Record<string, unknown>;
}

export function displayLocator(locator: Locator | undefined, resource?: GraphNode): LocatorDisplay | undefined {
  if (!locator) return undefined;
  const resourceMeta = metadata(resource);
  const url = typeof resourceMeta['url'] === 'string' ? resourceMeta['url'] : undefined;
  switch (locator.kind) {
    case 'timecode': {
      const label = formatTimestamp(locator.startSec);
      return { label, ...(url ? { url: buildTimestampUrl(url, locator.startSec) } : {}) };
    }
    case 'page':
      return { label: `page ${locator.page}` };
    case 'dom':
      return { label: 'web fragment' };
    case 'message':
      return { label: `message ${locator.messageId}` };
    case 'text':
      return { label: `text ${locator.charStart}-${locator.charEnd}` };
    case 'external':
      return { label: `${locator.system}:${locator.externalId}` };
  }
}

function locatorFromExcerpt(excerpt: GraphNode | undefined): Locator | undefined {
  const raw = metadata(excerpt)['locator'];
  if (raw && typeof raw === 'object' && 'kind' in raw) return raw as Locator;
  if (typeof metadata(excerpt)['start'] === 'number') {
    const startSec = toNumber(metadata(excerpt)['start'], 0);
    return { kind: 'timecode', startSec, endSec: toNumber(metadata(excerpt)['end'], startSec) };
  }
  return undefined;
}

async function allNodes(store: GraphStore, type: GraphNode['type']): Promise<Result<GraphNode[]>> {
  const result = await store.queryNodes({ type });
  if (!result.ok) return result;
  return ok(result.value.items);
}

async function mapNodes(store: GraphStore, type: GraphNode['type']): Promise<Result<Map<string, GraphNode>>> {
  const result = await allNodes(store, type);
  if (!result.ok) return result;
  return ok(new Map(result.value.map(node => [node.id, node])));
}

async function edgesBySubject(store: GraphStore, predicate: Predicate): Promise<Result<Map<string, string[]>>> {
  const result = await store.getEdges({ predicate });
  if (!result.ok) return result;
  const map = new Map<string, string[]>();
  for (const edge of result.value.items) {
    const list = map.get(edge.subject) ?? [];
    list.push(edge.object);
    map.set(edge.subject, list);
  }
  for (const list of map.values()) list.sort();
  return ok(map);
}

function chooseExcerpt(excerpts: GraphNode[]): GraphNode | undefined {
  return excerpts.slice().sort((a, b) => {
    const leftLocator = locatorFromExcerpt(a);
    const rightLocator = locatorFromExcerpt(b);
    const aStart = leftLocator?.kind === 'timecode' ? leftLocator.startSec : toNumber(metadata(a)['start'], 0);
    const bStart = rightLocator?.kind === 'timecode' ? rightLocator.startSec : toNumber(metadata(b)['start'], 0);
    if (aStart !== bStart) return aStart - bStart;
    return a.id.localeCompare(b.id);
  })[0];
}

async function ftsMatches(store: GraphStore, query: string): Promise<Result<{ claims: Set<string>; resources: Set<string>; excerpts: Set<string> } | null>> {
  const candidate = store as Partial<FtsCapableStore>;
  if (typeof candidate.supportsFts !== 'function' || typeof candidate.searchText !== 'function' || !candidate.supportsFts()) {
    return ok(null);
  }
  try {
    const claims = candidate.searchText(query, ['Claim']);
    const resources = candidate.searchText(query, ['Resource']);
    const excerpts = candidate.searchText(query, ['Excerpt']);
    if (!claims.ok || !resources.ok || !excerpts.ok) return ok(null);
    return ok({ claims: claims.value, resources: resources.value, excerpts: excerpts.value });
  } catch {
    return ok(null);
  }
}

async function claimIdsForProject(store: GraphStore, projectId: string): Promise<Result<Set<string>>> {
  const taskEdges = await store.getEdges({ predicate: 'taskPartOfProject', object: projectId });
  if (!taskEdges.ok) return taskEdges;
  const taskIds = new Set(taskEdges.value.items.map(edge => edge.subject));
  const motivated = await store.getEdges({ predicate: 'taskMotivatedBy' });
  if (!motivated.ok) return motivated;
  return ok(new Set(motivated.value.items.filter(edge => taskIds.has(edge.subject)).map(edge => edge.object)));
}

export async function searchActivationClaims(store: GraphStore, options: ActivationSearchOptions): Promise<Result<ActivationClaimHit[]>> {
  const query = options.query.trim();
  if (!query) return ok([]);
  const queryLower = query.toLowerCase();
  const claimFilter = options.projectId ? await claimIdsForProject(store, options.projectId) : ok(null);
  if (!claimFilter.ok) return claimFilter;
  const allowedStates = new Set(options.states ?? ['accepted']);

  const claims = await allNodes(store, 'Claim');
  if (!claims.ok) return claims;
  const resources = await mapNodes(store, 'Resource');
  if (!resources.ok) return resources;
  const excerpts = await mapNodes(store, 'Excerpt');
  if (!excerpts.ok) return excerpts;
  const derived = await edgesBySubject(store, 'claimDerivedFrom');
  if (!derived.ok) return derived;
  const fts = await ftsMatches(store, query);
  if (!fts.ok) return fts;

  const excerptMatchedClaims = new Set<string>();
  if (fts.value) {
    for (const [claimId, excerptIds] of derived.value) {
      if (excerptIds.some(id => fts.value?.excerpts.has(id))) excerptMatchedClaims.add(claimId);
    }
  }

  const hits: ActivationClaimHit[] = [];
  for (const claim of claims.value) {
    if (claimFilter.value && !claimFilter.value.has(claim.id)) continue;
    const claimState = normalizeClaimState(metadata(claim)['state']);
    if (!allowedStates.has(claimState)) continue;
    const resourceId = metadata(claim)['resourceId'];
    if (typeof resourceId !== 'string') continue;
    const resource = resources.value.get(resourceId);
    if (!resource) continue;
    const sourceType = typeof metadata(resource)['sourceType'] === 'string' ? metadata(resource)['sourceType'] as string : undefined;
    if (options.source && sourceType !== options.source && resource.id !== options.source) continue;

    let score = 0;
    if (fts.value) {
      if (fts.value.claims.has(claim.id)) score += 2;
      if (fts.value.resources.has(resource.id)) score += 1;
      if (excerptMatchedClaims.has(claim.id)) score += 1;
    } else {
      const claimText = normalize(claim.content ?? claim.label);
      const resourceText = normalize(resource.label);
      if (claimText.includes(queryLower)) score += 2;
      if (resourceText.includes(queryLower)) score += 1;
    }
    if (score <= 0) continue;

    const excerptIds = derived.value.get(claim.id) ?? [];
    const excerpt = chooseExcerpt(excerptIds.map(id => excerpts.value.get(id)).filter(Boolean) as GraphNode[]);
    const locator = locatorFromExcerpt(excerpt);
    hits.push({
      claimId: claim.id,
      claimText: (claim.content ?? claim.label).trim(),
      claimState,
      resourceId: resource.id,
      resourceTitle: resource.label,
      ...(sourceType ? { sourceType } : {}),
      ...(excerpt ? { excerptId: excerpt.id, excerptText: compact(excerpt.content), locator } : {}),
      ...(locator ? { locatorDisplay: displayLocator(locator, resource) } : {}),
      score,
      ...(normalizeRoutingStatus(metadata(claim)['routingReviewStatus']) ? { routingReviewStatus: normalizeRoutingStatus(metadata(claim)['routingReviewStatus']) } : {}),
      ...(typeof metadata(claim)['routingReviewReason'] === 'string' ? { routingReviewReason: metadata(claim)['routingReviewReason'] as string } : {}),
      ...(isReviewPriority(metadata(claim)['reviewPriority']) ? { reviewPriority: metadata(claim)['reviewPriority'] as ReviewPriority } : {}),
    });
  }

  hits.sort((a, b) => {
    if (a.score !== b.score) return b.score - a.score;
    const leftLocator = a.locator?.kind === 'timecode' ? a.locator.startSec : 0;
    const rightLocator = b.locator?.kind === 'timecode' ? b.locator.startSec : 0;
    if (leftLocator !== rightLocator) return leftLocator - rightLocator;
    return a.claimId.localeCompare(b.claimId);
  });
  return ok(hits.slice(0, options.limit ?? hits.length));
}

async function ensureProject(store: GraphStore, projectId: string): Promise<Result<{ node: GraphNode; created: boolean }>> {
  const existing = await store.getNode(projectId);
  if (!existing.ok) return existing;
  if (existing.value) return ok({ node: existing.value, created: false });
  const isInbox = projectId === DEFAULT_INBOX_PROJECT_ID;
  const data: NodeDataInput = {
    label: isInbox ? 'Inbox' : projectId,
    metadata: { slug: isInbox ? 'inbox' : projectId, default: isInbox },
  };
  const upsert = await store.upsertNode('Project', projectId, data, { detectNoop: true });
  if (!upsert.ok) return upsert;
  return ok({ node: upsert.value.node, created: upsert.value.created });
}

function normalizeProjectId(projectId?: string): string {
  if (!projectId?.trim()) return DEFAULT_INBOX_PROJECT_ID;
  if (projectId.trim().toLowerCase() === 'inbox') return DEFAULT_INBOX_PROJECT_ID;
  return projectId.trim();
}

export async function createActivationTaskFromClaim(store: GraphStore, input: CreateTaskFromClaimInput): Promise<Result<CreateTaskResult>> {
  const claim = await store.getNode(input.claimId);
  if (!claim.ok) return claim;
  if (!claim.value || claim.value.type !== 'Claim') return { ok: false, error: new Error(`Claim not found: ${input.claimId}`) };
  const projectId = normalizeProjectId(input.projectId);
  const project = await ensureProject(store, projectId);
  if (!project.ok) return project;
  const title = input.title?.trim() || claim.value.label;
  const taskId = stableHash('task', [projectId, input.claimId, title]);
  const upsert = await store.upsertNode('Task', taskId, {
    label: title,
    content: title,
    metadata: { projectId, sourceClaimId: input.claimId, status: 'open' },
  }, { detectNoop: true });
  if (!upsert.ok) return upsert;
  const motivated = await store.upsertEdge(taskId, 'taskMotivatedBy', input.claimId, { metadata: {} }, { detectNoop: true });
  if (!motivated.ok) return motivated;
  const projectEdge = await store.upsertEdge(taskId, 'taskPartOfProject', projectId, { metadata: {} }, { detectNoop: true });
  if (!projectEdge.ok) return projectEdge;
  for (const tag of input.tags ?? []) {
    if (!tag.trim()) continue;
    const tagId = stableHash('tag', [tag.trim().toLowerCase()]);
    const tagNode = await store.upsertNode('TopicTag', tagId, { label: tag.trim(), metadata: { slug: tag.trim().toLowerCase() } }, { detectNoop: true });
    if (!tagNode.ok) return tagNode;
    const edge = await store.upsertEdge(taskId, 'aboutTag', tagId, { metadata: {} }, { detectNoop: true });
    if (!edge.ok) return edge;
  }
  return ok({ taskId, projectId, createdProject: project.value.created, createdTask: upsert.value.created });
}

export async function getActivationTaskContext(store: GraphStore, taskId: string): Promise<Result<TaskContext>> {
  const task = await store.getNode(taskId);
  if (!task.ok) return task;
  if (!task.value || task.value.type !== 'Task') return { ok: false, error: new Error(`Task not found: ${taskId}`) };
  const projectEdge = await store.getEdges({ predicate: 'taskPartOfProject', subject: taskId });
  if (!projectEdge.ok) return projectEdge;
  const projectId = projectEdge.value.items[0]?.object;
  const project = projectId ? await store.getNode(projectId) : ok(null);
  if (!project.ok) return project;

  const tagEdges = await store.getEdges({ predicate: 'aboutTag', subject: taskId });
  if (!tagEdges.ok) return tagEdges;
  const tags: GraphNode[] = [];
  for (const edge of tagEdges.value.items) {
    const tag = await store.getNode(edge.object);
    if (!tag.ok) return tag;
    if (tag.value) tags.push(tag.value);
  }

  const motivated = await store.getEdges({ predicate: 'taskMotivatedBy', subject: taskId });
  if (!motivated.ok) return motivated;
  const claims: TaskClaimContext[] = [];
  for (const edge of motivated.value.items) {
    const claim = await store.getNode(edge.object);
    if (!claim.ok) return claim;
    if (!claim.value) continue;
    const resourceId = metadata(claim.value)['resourceId'];
    const resource = typeof resourceId === 'string' ? await store.getNode(resourceId) : ok(null);
    if (!resource.ok) return resource;
    const excerptEdges = await store.getEdges({ predicate: 'claimDerivedFrom', subject: claim.value.id });
    if (!excerptEdges.ok) return excerptEdges;
    const excerptNodes: GraphNode[] = [];
    for (const excerptEdge of excerptEdges.value.items) {
      const excerpt = await store.getNode(excerptEdge.object);
      if (!excerpt.ok) return excerpt;
      if (excerpt.value) excerptNodes.push(excerpt.value);
    }
    const excerpt = chooseExcerpt(excerptNodes);
    const locator = locatorFromExcerpt(excerpt);
    claims.push({
      claimId: claim.value.id,
      claimText: (claim.value.content ?? claim.value.label).trim(),
      ...(typeof resourceId === 'string' ? { resourceId } : {}),
      ...(resource.value ? { resourceTitle: resource.value.label } : {}),
      ...(excerpt ? { excerptId: excerpt.id, excerptText: compact(excerpt.content), locator } : {}),
      ...(locator ? { locatorDisplay: displayLocator(locator, resource.value ?? undefined) } : {}),
    });
  }

  tags.sort((a, b) => a.label.localeCompare(b.label) || a.id.localeCompare(b.id));
  return ok({ task: task.value, ...(project.value ? { project: project.value } : {}), claims, tags });
}

export function formatTaskContext(context: TaskContext): string {
  const lines = [`Task: ${context.task.label} (${context.task.id})`];
  if (context.project) lines.push(`Project: ${context.project.label} (${context.project.id})`);
  if (context.tags.length > 0) lines.push(`Tags: ${context.tags.map(tag => tag.label).join(', ')}`);
  lines.push('Claims:');
  if (context.claims.length === 0) lines.push('- None');
  for (const claim of context.claims) {
    const locator = claim.locatorDisplay ? `[${claim.locatorDisplay.label}] ` : '';
    lines.push(`- ${locator}${claim.claimText}`);
    if (claim.locatorDisplay?.url) lines.push(`  ${claim.locatorDisplay.url}`);
    if (claim.excerptText) lines.push(`  Excerpt: ${claim.excerptText}`);
    if (claim.resourceTitle) lines.push(`  Source: ${claim.resourceTitle}`);
  }
  return lines.join('\n');
}

function isReviewPriority(value: unknown): value is ReviewPriority {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return typeof record['score'] === 'number' && Array.isArray(record['reasons']) && typeof record['summary'] === 'string';
}

export function computeReviewPriority(claim: GraphNode): ReviewPriority {
  const reasons: string[] = [];
  let score = 0;
  const meta = metadata(claim);
  if (typeof meta['confidence'] === 'number' && meta['confidence'] < 0.7) {
    score += 30; reasons.push('low_confidence');
  }
  if (meta['activeProject'] === true || typeof meta['projectId'] === 'string') {
    score += 20; reasons.push('active_project');
  }
  const text = `${claim.label} ${claim.content ?? ''}`.toLowerCase();
  if (/\b(should|must|todo|next|action|decide|follow up)\b/.test(text)) {
    score += 15; reasons.push('action_implying');
  }
  if (normalizeRoutingStatus(meta['routingReviewStatus']) === 'unreviewed' && !meta['routingReviewReason']) {
    score += 10; reasons.push('missing_routing_reason');
  }
  if (text.includes('conflict') || text.includes('contradict')) {
    score += 25; reasons.push('conflict_marker');
  }
  return { score, reasons, summary: reasons.length ? reasons.join(', ') : 'routine review' };
}

export async function getActivationReviewQueue(store: GraphStore, options: ReviewQueueOptions = {}): Promise<Result<ReviewQueueItem[]>> {
  const claims = await allNodes(store, 'Claim');
  if (!claims.ok) return claims;
  const resources = await mapNodes(store, 'Resource');
  if (!resources.ok) return resources;
  const excerpts = await mapNodes(store, 'Excerpt');
  if (!excerpts.ok) return excerpts;
  const derived = await edgesBySubject(store, 'claimDerivedFrom');
  if (!derived.ok) return derived;
  const projectClaims = options.projectId ? await claimIdsForProject(store, options.projectId) : ok(null);
  if (!projectClaims.ok) return projectClaims;
  const stateFilter = new Set(options.states ?? ['draft']);
  const includeRouting = options.includeRouting ?? true;
  const items: ReviewQueueItem[] = [];

  for (const claim of claims.value) {
    if (projectClaims.value && !projectClaims.value.has(claim.id)) continue;
    const claimState = normalizeClaimState(metadata(claim)['state']);
    const routingReviewStatus = normalizeRoutingStatus(metadata(claim)['routingReviewStatus']);
    const axes: Array<'editorial' | 'routing'> = [];
    if (stateFilter.has(claimState)) axes.push('editorial');
    if (includeRouting && routingReviewStatus !== 'confirmed') axes.push('routing');
    if (axes.length === 0) continue;
    const resourceId = metadata(claim)['resourceId'];
    if (typeof resourceId !== 'string') continue;
    const resource = resources.value.get(resourceId);
    if (!resource) continue;
    const sourceType = typeof metadata(resource)['sourceType'] === 'string' ? metadata(resource)['sourceType'] as string : undefined;
    if (options.source && sourceType !== options.source && resource.id !== options.source) continue;
    const excerptIds = derived.value.get(claim.id) ?? [];
    const excerpt = chooseExcerpt(excerptIds.map(id => excerpts.value.get(id)).filter(Boolean) as GraphNode[]);
    const locator = locatorFromExcerpt(excerpt);
    const priority = isReviewPriority(metadata(claim)['reviewPriority'])
      ? metadata(claim)['reviewPriority'] as ReviewPriority
      : computeReviewPriority(claim);
    items.push({
      claimId: claim.id,
      claimText: (claim.content ?? claim.label).trim(),
      claimState,
      resourceId: resource.id,
      resourceTitle: resource.label,
      ...(sourceType ? { sourceType } : {}),
      ...(excerpt ? { excerptId: excerpt.id, excerptText: compact(excerpt.content), locator } : {}),
      ...(locator ? { locatorDisplay: displayLocator(locator, resource) } : {}),
      score: priority.score,
      ...(routingReviewStatus ? { routingReviewStatus } : {}),
      ...(typeof metadata(claim)['routingReviewReason'] === 'string' ? { routingReviewReason: metadata(claim)['routingReviewReason'] as string } : {}),
      reviewPriority: priority,
      reviewAxes: axes,
    });
  }
  items.sort((a, b) => {
    const aScore = a.reviewPriority?.score ?? 0;
    const bScore = b.reviewPriority?.score ?? 0;
    if (aScore !== bScore) return bScore - aScore;
    if (a.claimState !== b.claimState) return a.claimState.localeCompare(b.claimState);
    return a.claimId.localeCompare(b.claimId);
  });
  return ok(items.slice(0, options.limit ?? items.length));
}

export async function buildProjectReentryDossier(store: GraphStore, projectId: string): Promise<Result<ProjectReentryDossier>> {
  const project = await store.getNode(projectId);
  if (!project.ok) return project;
  if (!project.value || project.value.type !== 'Project') return { ok: false, error: new Error(`Project not found: ${projectId}`) };
  const taskEdges = await store.getEdges({ predicate: 'taskPartOfProject', object: projectId });
  if (!taskEdges.ok) return taskEdges;
  const tasks: TaskContext[] = [];
  for (const edge of taskEdges.value.items.sort((a, b) => a.subject.localeCompare(b.subject))) {
    const task = await getActivationTaskContext(store, edge.subject);
    if (!task.ok) return task;
    tasks.push(task.value);
  }
  const claimContexts = tasks.flatMap(task => task.claims);
  const flatClaims: ActivationClaimHit[] = [];
  for (const context of claimContexts) {
    const claim = await store.getNode(context.claimId);
    if (!claim.ok) return claim;
    if (!claim.value) continue;
    flatClaims.push({
      claimId: context.claimId,
      claimText: context.claimText,
      claimState: normalizeClaimState(metadata(claim.value)['state']),
      resourceId: context.resourceId ?? '',
      resourceTitle: context.resourceTitle ?? 'Unknown source',
      ...(context.excerptId ? { excerptId: context.excerptId } : {}),
      ...(context.excerptText ? { excerptText: context.excerptText } : {}),
      ...(context.locator ? { locator: context.locator } : {}),
      ...(context.locatorDisplay ? { locatorDisplay: context.locatorDisplay } : {}),
      score: 1,
      ...(normalizeRoutingStatus(metadata(claim.value)['routingReviewStatus']) ? { routingReviewStatus: normalizeRoutingStatus(metadata(claim.value)['routingReviewStatus']) } : {}),
    });
  }
  const reviewItems = await getActivationReviewQueue(store, { projectId, limit: 10 });
  if (!reviewItems.ok) return reviewItems;
  const dependencyEdges = await store.getEdges({ predicate: 'taskDependsOn' });
  if (!dependencyEdges.ok) return dependencyEdges;
  const taskMap = new Map(tasks.map(task => [task.task.id, task.task]));
  const blockers = [];
  for (const edge of dependencyEdges.value.items) {
    if (!taskMap.has(edge.subject)) continue;
    const blockedBy = await store.getNode(edge.object);
    if (!blockedBy.ok) return blockedBy;
    blockers.push({
      taskId: edge.subject,
      taskLabel: taskMap.get(edge.subject)?.label ?? edge.subject,
      blockedByTaskId: edge.object,
      blockedByTaskLabel: blockedBy.value?.label ?? edge.object,
    });
  }
  const provenance = flatClaims.map(claim => ({
    claimId: claim.claimId,
    ...(claim.excerptId ? { excerptId: claim.excerptId } : {}),
    resourceId: claim.resourceId,
    resourceTitle: claim.resourceTitle,
    ...(claim.locatorDisplay ? { locator: claim.locatorDisplay } : {}),
  }));
  const suggestedNextActions = tasks.length > 0
    ? tasks.slice(0, 3).map(task => `Continue: ${task.task.label}`)
    : [`Review project ${project.value.label}`];
  return ok({
    project: { id: project.value.id, label: project.value.label },
    claims: flatClaims.sort((a, b) => a.claimId.localeCompare(b.claimId)),
    tasks,
    blockers,
    reviewItems: reviewItems.value,
    suggestedNextActions,
    provenance,
  });
}

export function renderProjectReentryMarkdown(dossier: ProjectReentryDossier): string {
  const lines = [`# Project Re-entry: ${dossier.project.label}`, '', '## Suggested Next Actions'];
  for (const action of dossier.suggestedNextActions) lines.push(`- ${action}`);
  lines.push('', '## Open Tasks');
  for (const task of dossier.tasks) lines.push(`- ${task.task.label} (${task.task.id})`);
  lines.push('', '## Relevant Claims');
  for (const claim of dossier.claims) {
    const loc = claim.locatorDisplay ? ` [${claim.locatorDisplay.label}]` : '';
    lines.push(`- ${claim.claimText}${loc}`);
  }
  lines.push('', '## Review Items');
  for (const item of dossier.reviewItems) lines.push(`- ${item.reviewAxes.join('+')}: ${item.claimText}`);
  lines.push('', '## Blockers');
  if (dossier.blockers.length === 0) lines.push('- None');
  for (const blocker of dossier.blockers) lines.push(`- ${blocker.taskLabel} depends on ${blocker.blockedByTaskLabel}`);
  lines.push('', '## Provenance');
  for (const item of dossier.provenance) {
    const loc = item.locator ? ` (${item.locator.label})` : '';
    lines.push(`- ${item.claimId} -> ${item.resourceTitle}${loc}`);
  }
  return `${lines.join('\n')}\n`;
}

export function isPredicate(value: string): value is Predicate {
  return PredicateSchema.safeParse(value).success;
}
