import type { GraphNode, GraphStore } from '@aidha/graph-backend';
import type { Result } from '../pipeline/types.js';
import type { ClaimState } from '../utils/claim-state.js';
import { DEFAULT_CLAIM_STATE, normalizeClaimState } from '../utils/claim-state.js';

export interface SearchOptions {
  query: string;
  limit?: number;
  projectId?: string;
  areaId?: string;
  goalId?: string;
  states?: ClaimState[];
}

export interface ClaimSearchHit {
  claimId: string;
  claimText: string;
  resourceId: string;
  resourceTitle: string;
  videoId?: string;
  timestampSeconds: number;
  timestampLabel: string;
  timestampUrl: string;
  excerptText: string;
  score: number;
}

interface FtsCapableGraphStore extends GraphStore {
  supportsFts(): boolean;
  searchText(query: string, types?: string[]): Result<Set<string>>;
}

function normalize(text: string | undefined): string {
  return (text ?? '').toLowerCase();
}

function formatTimestamp(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const hrs = Math.floor(total / 3600);
  const mins = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  if (hrs > 0) {
    return `${hrs}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

function buildTimestampUrl(baseUrl: string, seconds: number): string {
  const separator = baseUrl.includes('?') ? '&' : '?';
  return `${baseUrl}${separator}t=${Math.max(0, Math.floor(seconds))}s`;
}

function toNumber(value: unknown, fallback: number): number {
  if (typeof value === 'number' && !Number.isNaN(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value);
    return Number.isNaN(parsed) ? fallback : parsed;
  }
  return fallback;
}

function selectExcerpt(excerpts: GraphNode[]): GraphNode | undefined {
  if (excerpts.length === 0) return undefined;
  return excerpts.slice().sort((a, b) => {
    const aStart = toNumber(a.metadata?.['start'], 0);
    const bStart = toNumber(b.metadata?.['start'], 0);
    if (aStart !== bStart) return aStart - bStart;
    return a.id.localeCompare(b.id);
  })[0];
}

function scoreClaim(claim: GraphNode, resource: GraphNode, queryLower: string): number {
  const claimText = normalize(claim.content ?? claim.label);
  const resourceTitle = normalize(resource.label);
  let score = 0;
  if (claimText.includes(queryLower)) score += 2;
  if (resourceTitle.includes(queryLower)) score += 1;
  return score;
}

async function tasksForProject(
  graphStore: GraphStore,
  projectId: string
): Promise<Result<Set<string>>> {
  const edges = await graphStore.getEdges({ predicate: 'taskPartOfProject', object: projectId });
  if (!edges.ok) return edges;
  return { ok: true, value: new Set(edges.value.items.map(edge => edge.subject)) };
}

async function projectsForArea(
  graphStore: GraphStore,
  areaId: string
): Promise<Result<Set<string>>> {
  const edges = await graphStore.getEdges({ predicate: 'projectInArea', object: areaId });
  if (!edges.ok) return edges;
  return { ok: true, value: new Set(edges.value.items.map(edge => edge.subject)) };
}

async function projectsForGoal(
  graphStore: GraphStore,
  goalId: string
): Promise<Result<Set<string>>> {
  const edges = await graphStore.getEdges({ predicate: 'projectServesGoal', object: goalId });
  if (!edges.ok) return edges;
  return { ok: true, value: new Set(edges.value.items.map(edge => edge.subject)) };
}

async function tasksForProjects(
  graphStore: GraphStore,
  projectIds: Set<string>
): Promise<Result<Set<string>>> {
  const tasks = new Set<string>();
  for (const projectId of projectIds) {
    const result = await tasksForProject(graphStore, projectId);
    if (!result.ok) return result;
    for (const taskId of result.value) tasks.add(taskId);
  }
  return { ok: true, value: tasks };
}

async function resolveFilteredClaims(
  graphStore: GraphStore,
  options: SearchOptions
): Promise<Result<Set<string> | null>> {
  const filters: Array<Promise<Result<Set<string>>>> = [];

  if (options.projectId) {
    filters.push(tasksForProject(graphStore, options.projectId));
  }
  if (options.areaId) {
    filters.push(
      (async () => {
        const projects = await projectsForArea(graphStore, options.areaId ?? '');
        if (!projects.ok) return projects;
        return tasksForProjects(graphStore, projects.value);
      })()
    );
  }
  if (options.goalId) {
    filters.push(
      (async () => {
        const projects = await projectsForGoal(graphStore, options.goalId ?? '');
        if (!projects.ok) return projects;
        return tasksForProjects(graphStore, projects.value);
      })()
    );
  }

  if (filters.length === 0) {
    return { ok: true, value: null };
  }

  const resolved = await Promise.all(filters);
  const taskSets: Set<string>[] = [];
  for (const result of resolved) {
    if (!result.ok) return result;
    taskSets.push(result.value);
  }
  let intersection = new Set(taskSets[0]);
  for (const set of taskSets.slice(1)) {
    intersection = new Set([...intersection].filter(taskId => set.has(taskId)));
  }

  if (intersection.size === 0) {
    return { ok: true, value: new Set() };
  }

  const edges = await graphStore.getEdges({ predicate: 'taskMotivatedBy' });
  if (!edges.ok) return edges;
  const claims = new Set<string>();
  for (const edge of edges.value.items) {
    if (intersection.has(edge.subject)) {
      claims.add(edge.object);
    }
  }
  return { ok: true, value: claims };
}

async function resolveFtsMatches(
  graphStore: GraphStore,
  query: string
): Promise<Result<{ claimIds: Set<string>; resourceIds: Set<string>; excerptIds: Set<string> } | null>> {
  const maybeFtsStore = graphStore as Partial<FtsCapableGraphStore>;
  if (typeof maybeFtsStore.supportsFts !== 'function' || typeof maybeFtsStore.searchText !== 'function') {
    return { ok: true, value: null };
  }
  if (!maybeFtsStore.supportsFts()) {
    return { ok: true, value: null };
  }
  const ftsStore = maybeFtsStore as FtsCapableGraphStore;
  let claimsResult: Result<Set<string>>;
  let resourcesResult: Result<Set<string>>;
  let excerptsResult: Result<Set<string>>;
  try {
    claimsResult = ftsStore.searchText(query, ['Claim']);
    resourcesResult = ftsStore.searchText(query, ['Resource']);
    excerptsResult = ftsStore.searchText(query, ['Excerpt']);
  } catch {
    return { ok: true, value: null };
  }
  if (!claimsResult.ok || !resourcesResult.ok || !excerptsResult.ok) {
    return { ok: true, value: null };
  }

  return {
    ok: true,
    value: {
      claimIds: claimsResult.value,
      resourceIds: resourcesResult.value,
      excerptIds: excerptsResult.value,
    },
  };
}

export async function searchClaims(
  graphStore: GraphStore,
  options: SearchOptions
): Promise<Result<ClaimSearchHit[]>> {
  const queryLower = normalize(options.query);
  if (!queryLower) {
    return { ok: true, value: [] };
  }

  const filteredClaims = await resolveFilteredClaims(graphStore, options);
  if (!filteredClaims.ok) return filteredClaims;
  const claimFilter = filteredClaims.value;
  const allowedStates = new Set(options.states ?? [DEFAULT_CLAIM_STATE]);

  const ftsMatches = await resolveFtsMatches(graphStore, options.query);
  if (!ftsMatches.ok) return ftsMatches;
  const fts = ftsMatches.value;
  if (fts && fts.claimIds.size === 0 && fts.resourceIds.size === 0 && fts.excerptIds.size === 0) {
    return { ok: true, value: [] };
  }

  const claimsResult = await graphStore.queryNodes({ type: 'Claim' });
  if (!claimsResult.ok) return claimsResult;

  const resourcesResult = await graphStore.queryNodes({ type: 'Resource' });
  if (!resourcesResult.ok) return resourcesResult;
  const resourceMap = new Map(resourcesResult.value.items.map(resource => [resource.id, resource]));

  const excerptResult = await graphStore.queryNodes({ type: 'Excerpt' });
  if (!excerptResult.ok) return excerptResult;
  const excerptMap = new Map(excerptResult.value.items.map(excerpt => [excerpt.id, excerpt]));

  const derivedEdgesResult = await graphStore.getEdges({ predicate: 'claimDerivedFrom' });
  if (!derivedEdgesResult.ok) return derivedEdgesResult;

  const edgesByClaim = new Map<string, string[]>();
  for (const edge of derivedEdgesResult.value.items) {
    const list = edgesByClaim.get(edge.subject) ?? [];
    list.push(edge.object);
    edgesByClaim.set(edge.subject, list);
  }

  const excerptMatchedClaims = new Set<string>();
  if (fts) {
    for (const edge of derivedEdgesResult.value.items) {
      if (fts.excerptIds.has(edge.object)) {
        excerptMatchedClaims.add(edge.subject);
      }
    }
  }

  const hits: ClaimSearchHit[] = [];
  for (const claim of claimsResult.value.items) {
    if (claimFilter && !claimFilter.has(claim.id)) continue;
    const state = normalizeClaimState(claim.metadata?.['state']) ?? DEFAULT_CLAIM_STATE;
    if (!allowedStates.has(state)) continue;
    const resourceId = claim.metadata?.['resourceId'] as string | undefined;
    if (!resourceId) continue;
    const resource = resourceMap.get(resourceId);
    if (!resource) continue;

    let score = 0;
    if (fts) {
      if (fts.claimIds.has(claim.id)) score += 2;
      if (excerptMatchedClaims.has(claim.id)) score += 1;
      if (fts.resourceIds.has(resourceId)) score += 1;
    } else {
      score = scoreClaim(claim, resource, queryLower);
    }
    if (score <= 0) continue;

    const excerptIds = edgesByClaim.get(claim.id) ?? [];
    const excerpts = excerptIds.map(id => excerptMap.get(id)).filter(Boolean) as GraphNode[];
    const excerpt = selectExcerpt(excerpts);

    const timestampSeconds = excerpt ? toNumber(excerpt.metadata?.['start'], 0) : 0;
    const videoId = claim.metadata?.['videoId'] as string | undefined;
    const resourceUrl = resource.metadata?.['url'] as string | undefined;
    const baseUrl = resourceUrl || (videoId ? `https://www.youtube.com/watch?v=${videoId}` : undefined);
    if (!baseUrl) continue;
    const excerptText = (excerpt?.content ?? '').replace(/\s+/g, ' ').trim();

    hits.push({
      claimId: claim.id,
      claimText: (claim.content ?? claim.label).trim(),
      resourceId,
      resourceTitle: resource.label,
      videoId,
      timestampSeconds,
      timestampLabel: formatTimestamp(timestampSeconds),
      timestampUrl: buildTimestampUrl(baseUrl, timestampSeconds),
      excerptText,
      score,
    });
  }

  const sorted = hits.sort((a, b) => {
    if (a.score !== b.score) return b.score - a.score;
    if (a.timestampSeconds !== b.timestampSeconds) return a.timestampSeconds - b.timestampSeconds;
    return a.claimId.localeCompare(b.claimId);
  });

  const limit = options.limit ?? sorted.length;
  return { ok: true, value: sorted.slice(0, limit) };
}
