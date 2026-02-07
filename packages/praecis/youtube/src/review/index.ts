import type {
  GraphNode,
  GraphStore,
  NodeDataInput,
} from '@aidha/graph-backend';
import type { Result } from '../pipeline/types.js';
import { createTaskFromClaim } from '../tasks/index.js';
import type { ClaimState } from '../utils/claim-state.js';
import { DEFAULT_CLAIM_STATE, normalizeClaimState } from '../utils/claim-state.js';
import { hashId } from '../utils/ids.js';

function toNumber(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && !Number.isNaN(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value);
    return Number.isNaN(parsed) ? fallback : parsed;
  }
  return fallback;
}

function formatTimestamp(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

function buildTimestampUrl(baseUrl: string, seconds: number): string {
  const safeSeconds = Math.max(0, Math.floor(seconds));
  try {
    const parsed = new URL(baseUrl);
    parsed.searchParams.set('t', `${safeSeconds}s`);
    return parsed.toString();
  } catch {
    const hashIndex = baseUrl.indexOf('#');
    const withoutHash = hashIndex >= 0 ? baseUrl.slice(0, hashIndex) : baseUrl;
    const hashSuffix = hashIndex >= 0 ? baseUrl.slice(hashIndex) : '';
    const separator = withoutHash.includes('?') ? '&' : '?';
    return `${withoutHash}${separator}t=${safeSeconds}s${hashSuffix}`;
  }
}

function normalizeTagId(tag: string): string {
  const slug = tag.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return slug.length > 0 ? `tag-${slug}` : hashId('tag', [tag]);
}

function normalizeClaimText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
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
  const created = await store.getNode(tagId);
  if (!created.ok) return created;
  if (!created.value) return { ok: false, error: new Error(`TopicTag not found: ${tagId}`) };
  return { ok: true, value: created.value };
}

function chooseExcerpt(excerpts: GraphNode[]): GraphNode | undefined {
  return excerpts.slice().sort((a, b) => {
    const aStart = toNumber(a.metadata?.['start'], 0);
    const bStart = toNumber(b.metadata?.['start'], 0);
    if (aStart !== bStart) return aStart - bStart;
    return a.id.localeCompare(b.id);
  })[0];
}

export interface ReviewQueueOptions {
  videoId?: string;
  resourceId?: string;
  limit?: number;
  states?: ClaimState[];
}

export interface ReviewQueueItem {
  claimId: string;
  claimText: string;
  claimState: ClaimState;
  resourceId: string;
  resourceTitle: string;
  timestampSeconds: number;
  timestampLabel: string;
  timestampUrl?: string;
  excerptText?: string;
}

export interface ReviewActionInput {
  claimIds: string[];
  state?: ClaimState;
  text?: string;
  tags?: string[];
  createTask?: {
    title: string;
    projectId?: string;
  };
}

export interface ReviewActionResult {
  updatedClaims: number;
  updatedTags: number;
  createdTasks: number;
}

interface ReviewClaimPlan {
  claimId: string;
  label: string;
  content?: string;
  metadata: Record<string, unknown>;
}

interface TransactionalStore {
  runInTransaction<T>(work: () => Promise<Result<T>>): Promise<Result<T>>;
}

function hasTransactions(store: GraphStore): store is GraphStore & TransactionalStore {
  return typeof (store as Partial<TransactionalStore>).runInTransaction === 'function';
}

async function runAtomically<T>(
  store: GraphStore,
  work: () => Promise<Result<T>>
): Promise<Result<T>> {
  if (!hasTransactions(store)) {
    return work();
  }
  return store.runInTransaction(work);
}

async function buildClaimPlans(
  store: GraphStore,
  claimIds: string[],
  state: ClaimState | undefined,
  text: string | undefined
): Promise<Result<ReviewClaimPlan[]>> {
  const plans: ReviewClaimPlan[] = [];
  for (const claimId of claimIds) {
    const claimResult = await store.getNode(claimId);
    if (!claimResult.ok) return claimResult;
    if (!claimResult.value || claimResult.value.type !== 'Claim') {
      return { ok: false, error: new Error(`Claim not found: ${claimId}`) };
    }
    const claim = claimResult.value;
    const metadata: Record<string, unknown> = { ...(claim.metadata as Record<string, unknown>) };
    if (state) {
      metadata['state'] = state;
    }
    const nextText = text?.trim() ? normalizeClaimText(text) : claim.content;
    const nextLabel = (nextText ?? claim.label).slice(0, 120);
    plans.push({
      claimId,
      label: nextLabel,
      content: nextText,
      metadata,
    });
  }
  return { ok: true, value: plans };
}

export async function getReviewQueue(
  store: GraphStore,
  options: ReviewQueueOptions
): Promise<Result<ReviewQueueItem[]>> {
  const resourceId = options.resourceId ?? (options.videoId ? `youtube-${options.videoId}` : undefined);
  const claimResult = await store.queryNodes({
    type: 'Claim',
    filters: resourceId ? { resourceId } : undefined,
  });
  if (!claimResult.ok) return claimResult;

  const excerptResult = await store.queryNodes({ type: 'Excerpt' });
  if (!excerptResult.ok) return excerptResult;
  const excerptMap = new Map(excerptResult.value.items.map(item => [item.id, item]));

  const resourceResult = await store.queryNodes({ type: 'Resource' });
  if (!resourceResult.ok) return resourceResult;
  const resourceMap = new Map(resourceResult.value.items.map(item => [item.id, item]));

  const derivedEdges = await store.getEdges({ predicate: 'claimDerivedFrom' });
  if (!derivedEdges.ok) return derivedEdges;
  const excerptIdsByClaim = new Map<string, string[]>();
  for (const edge of derivedEdges.value.items) {
    const current = excerptIdsByClaim.get(edge.subject) ?? [];
    current.push(edge.object);
    excerptIdsByClaim.set(edge.subject, current);
  }

  const stateFilter = new Set(options.states ?? ['draft']);
  const items: ReviewQueueItem[] = [];
  for (const claim of claimResult.value.items) {
    const state = normalizeClaimState(claim.metadata?.['state']) ?? DEFAULT_CLAIM_STATE;
    if (!stateFilter.has(state)) continue;

    const claimResourceId = claim.metadata?.['resourceId'];
    if (typeof claimResourceId !== 'string' || claimResourceId.length === 0) continue;
    const resource = resourceMap.get(claimResourceId);
    if (!resource) continue;

    const claimExcerptIds = excerptIdsByClaim.get(claim.id) ?? [];
    const claimExcerpts = claimExcerptIds
      .map(id => excerptMap.get(id))
      .filter((item): item is GraphNode => Boolean(item));
    const excerpt = chooseExcerpt(claimExcerpts);
    const timestampSeconds = excerpt ? toNumber(excerpt.metadata?.['start'], 0) : 0;
    const fallbackVideoId = options.videoId;
    const baseUrl = (resource.metadata?.['url'] as string | undefined) ??
      (fallbackVideoId ? `https://www.youtube.com/watch?v=${fallbackVideoId}` : undefined);

    items.push({
      claimId: claim.id,
      claimText: normalizeClaimText(claim.content ?? claim.label),
      claimState: state,
      resourceId: claimResourceId,
      resourceTitle: resource.label,
      timestampSeconds,
      timestampLabel: formatTimestamp(timestampSeconds),
      timestampUrl: baseUrl ? buildTimestampUrl(baseUrl, timestampSeconds) : undefined,
      excerptText: excerpt?.content?.replace(/\s+/g, ' ').trim(),
    });
  }

  const sorted = items.sort((a, b) => {
    if (a.timestampSeconds !== b.timestampSeconds) return a.timestampSeconds - b.timestampSeconds;
    return a.claimId.localeCompare(b.claimId);
  });

  return { ok: true, value: sorted.slice(0, options.limit ?? sorted.length) };
}

export async function applyReviewAction(
  store: GraphStore,
  input: ReviewActionInput
): Promise<Result<ReviewActionResult>> {
  const claimIds = Array.from(new Set(input.claimIds.map(id => id.trim()).filter(Boolean)));
  if (claimIds.length === 0) {
    return { ok: false, error: new Error('No claim IDs provided.') };
  }
  if (claimIds.length > 1 && !hasTransactions(store)) {
    return {
      ok: false,
      error: new Error('Batch review apply requires a transaction-capable store backend.'),
    };
  }
  if (input.createTask && !input.createTask.title.trim()) {
    return { ok: false, error: new Error('Task title is required when creating tasks.') };
  }

  const cleanedTags = (input.tags ?? []).map(tag => tag.trim()).filter(Boolean);
  return runAtomically(store, async () => {
    const claimPlans = await buildClaimPlans(store, claimIds, input.state, input.text);
    if (!claimPlans.ok) return claimPlans;

    let updatedClaims = 0;
    let updatedTags = 0;
    let createdTasks = 0;

    for (const plan of claimPlans.value) {
      const upsert = await store.upsertNode(
        'Claim',
        plan.claimId,
        {
          label: plan.label,
          content: plan.content,
          metadata: plan.metadata,
        },
        { detectNoop: true }
      );
      if (!upsert.ok) return upsert;
      if (upsert.value.updated || upsert.value.created) updatedClaims += 1;

      for (const tag of cleanedTags) {
        const tagNode = await ensureTag(store, tag);
        if (!tagNode.ok) return tagNode;
        const edge = await store.upsertEdge(
          plan.claimId,
          'aboutTag',
          tagNode.value.id,
          { metadata: {} },
          { detectNoop: true }
        );
        if (!edge.ok) return edge;
        if (edge.value.created || edge.value.updated) updatedTags += 1;
      }

      if (input.createTask) {
        const task = await createTaskFromClaim(store, {
          claimId: plan.claimId,
          title: input.createTask.title,
          projectId: input.createTask.projectId,
          tags: cleanedTags,
        });
        if (!task.ok) return task;
        if (task.value.createdTask) createdTasks += 1;
      }
    }

    return {
      ok: true,
      value: {
        updatedClaims,
        updatedTags,
        createdTasks,
      },
    };
  });
}
