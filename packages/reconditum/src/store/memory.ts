/**
 * In-memory graph store implementation.
 *
 * Simple Map-based storage for MVP and testing.
 * Can be replaced with LevelGraph/Neo4j later via the adapter pattern.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import type {
  GraphStore,
  Result,
  QueryNodesOptions,
  QueryEdgesOptions,
  NodeDataInput,
  EdgeDataInput,
  UpsertNodeOptions,
  UpsertEdgeOptions,
  UpsertNodeResult,
  UpsertEdgeResult,
  DeleteNodeOptions,
  ExportSnapshotOptions,
  GraphSnapshot,
  QueryResult,
  ExportGephiOptions,
  GephiExport,
  GephiNode,
  GephiEdge,
  GetGraphStatsOptions,
  GraphStats,
} from './types.js';
import type {
  GraphNode,
  GraphEdge,
  NodeType,
  Predicate,
} from '../schema/index.js';
import { GraphNode as GraphNodeSchema, GraphEdge as GraphEdgeSchema } from '../schema/index.js';
import {
  nowIso,
  deepEqual,
  nodeMatchesFilters,
  sortNodes,
  sortEdges,
  nodeCursorKey,
  edgeCursorKey,
  applyCursorAndLimit,
} from './utils.js';

/**
 * Edge storage key.
 */
function edgeKey(subject: string, predicate: string, object: string): string {
  return `${subject}|${predicate}|${object}`;
}

function cloneMetadata(metadata: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!metadata) return {};
  return JSON.parse(JSON.stringify(metadata)) as Record<string, unknown>;
}

function cloneNode(node: GraphNode): GraphNode {
  return {
    ...node,
    metadata: cloneMetadata(node.metadata),
  };
}

function cloneEdge(edge: GraphEdge): GraphEdge {
  return {
    ...edge,
    metadata: cloneMetadata(edge.metadata),
  };
}

/**
 * In-memory graph store for MVP and testing.
 */
export class InMemoryStore implements GraphStore {
  private nodes = new Map<string, GraphNode>();
  private edges = new Map<string, GraphEdge>();
  private transactionDepth = 0;
  private transactionQueue: Promise<void> = Promise.resolve();
  private transactionOwner?: symbol;
  private readonly transactionContext = new AsyncLocalStorage<symbol>();

  private async withTransactionLock<T>(work: () => Promise<T>): Promise<T> {
    const previous = this.transactionQueue;
    let release: (() => void) | undefined;
    this.transactionQueue = new Promise<void>(resolve => {
      release = resolve;
    });
    await previous;
    try {
      return await work();
    } finally {
      release?.();
    }
  }

  async runInTransaction<T>(work: () => Promise<Result<T>>): Promise<Result<T>> {
    const contextOwner = this.transactionContext.getStore();
    if (contextOwner && contextOwner === this.transactionOwner) {
      this.transactionDepth += 1;
      try {
        return await work();
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error : new Error(String(error)) };
      } finally {
        this.transactionDepth -= 1;
      }
    }

    return this.withTransactionLock(async () => {
      const nodeSnapshot = new Map<string, GraphNode>();
      const edgeSnapshot = new Map<string, GraphEdge>();
      for (const [id, node] of this.nodes.entries()) {
        nodeSnapshot.set(id, cloneNode(node));
      }
      for (const [id, edge] of this.edges.entries()) {
        edgeSnapshot.set(id, cloneEdge(edge));
      }

      const ownerToken = Symbol('memory-store-transaction');
      this.transactionOwner = ownerToken;
      this.transactionDepth += 1;
      try {
        const result = await this.transactionContext.run(ownerToken, async () => work());
        if (!result.ok) {
          this.nodes = nodeSnapshot;
          this.edges = edgeSnapshot;
        }
        return result;
      } catch (error) {
        this.nodes = nodeSnapshot;
        this.edges = edgeSnapshot;
        return { ok: false, error: error instanceof Error ? error : new Error(String(error)) };
      } finally {
        this.transactionDepth -= 1;
        if (this.transactionDepth === 0) {
          this.transactionOwner = undefined;
        }
      }
    });
  }

  async upsertNode(
    type: NodeType,
    id: string,
    data: NodeDataInput,
    options?: UpsertNodeOptions
  ): Promise<Result<UpsertNodeResult>> {
    try {
      const existing = this.nodes.get(id);
      const metadata = data.metadata ?? {};

      if (!existing) {
        const timestamp = nowIso();
        const node: GraphNode = {
          id,
          type,
          label: data.label,
          content: data.content,
          metadata,
          createdAt: timestamp,
          updatedAt: timestamp,
        };
        const validated = GraphNodeSchema.parse(node);
        this.nodes.set(validated.id, validated);
        return { ok: true, value: { node: validated, created: true, updated: false, noop: false } };
      }

      const shouldDetectNoop = options?.detectNoop ?? true;
      if (
        shouldDetectNoop &&
        existing.type === type &&
        existing.label === data.label &&
        existing.content === data.content &&
        deepEqual(existing.metadata ?? {}, metadata)
      ) {
        return { ok: true, value: { node: existing, created: false, updated: false, noop: true } };
      }

      const updated: GraphNode = {
        ...existing,
        id: existing.id,
        type,
        label: data.label,
        content: data.content,
        metadata,
        createdAt: existing.createdAt,
        updatedAt: nowIso(),
      };

      const validated = GraphNodeSchema.parse(updated);
      this.nodes.set(id, validated);

      return { ok: true, value: { node: validated, created: false, updated: true, noop: false } };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error : new Error(String(error)) };
    }
  }

  async getNode(id: string): Promise<Result<GraphNode | null>> {
    try {
      const node = this.nodes.get(id) ?? null;
      return { ok: true, value: node };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error : new Error(String(error)) };
    }
  }

  async deleteNode(id: string, options?: DeleteNodeOptions): Promise<Result<void>> {
    try {
      this.nodes.delete(id);
      if (options?.cascade) {
        for (const [key, edge] of this.edges.entries()) {
          if (edge.subject === id || edge.object === id) {
            this.edges.delete(key);
          }
        }
      }
      return { ok: true, value: undefined };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error : new Error(String(error)) };
    }
  }

  async queryNodes(options: QueryNodesOptions = {}): Promise<Result<QueryResult<GraphNode>>> {
    try {
      let nodes = Array.from(this.nodes.values());

      if (options.type) {
        nodes = nodes.filter(node => node.type === options.type);
      }

      nodes = nodes.filter(node => nodeMatchesFilters(node, options.filters));
      const sorted = sortNodes(nodes, options.sort);
      const paged = applyCursorAndLimit(sorted, options.cursor, options.limit, nodeCursorKey);

      return { ok: true, value: paged };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error : new Error(String(error)) };
    }
  }

  async upsertEdge(
    subject: string,
    predicate: Predicate,
    object: string,
    data: EdgeDataInput,
    options?: UpsertEdgeOptions
  ): Promise<Result<UpsertEdgeResult>> {
    try {
      const key = edgeKey(subject, predicate, object);
      const existing = this.edges.get(key);
      const metadata = data.metadata ?? {};

      if (!existing) {
        const edge: GraphEdge = {
          subject,
          predicate,
          object,
          metadata,
          createdAt: nowIso(),
        };
        const validated = GraphEdgeSchema.parse(edge);
        this.edges.set(key, validated);
        return { ok: true, value: { edge: validated, created: true, updated: false, noop: false } };
      }

      const shouldDetectNoop = options?.detectNoop ?? true;
      if (shouldDetectNoop && deepEqual(existing.metadata ?? {}, metadata)) {
        return { ok: true, value: { edge: existing, created: false, updated: false, noop: true } };
      }

      const updated: GraphEdge = {
        ...existing,
        subject,
        predicate,
        object,
        metadata,
        createdAt: existing.createdAt,
      };
      const validated = GraphEdgeSchema.parse(updated);
      this.edges.set(key, validated);

      return { ok: true, value: { edge: validated, created: false, updated: true, noop: false } };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error : new Error(String(error)) };
    }
  }

  async getEdges(options: QueryEdgesOptions = {}): Promise<Result<QueryResult<GraphEdge>>> {
    try {
      let edges = Array.from(this.edges.values());

      if (options.subject) {
        edges = edges.filter(edge => edge.subject === options.subject);
      }
      if (options.predicate) {
        edges = edges.filter(edge => edge.predicate === options.predicate);
      }
      if (options.object) {
        edges = edges.filter(edge => edge.object === options.object);
      }

      const sorted = sortEdges(edges, options.sort);
      const paged = applyCursorAndLimit(sorted, options.cursor, options.limit, edgeCursorKey);
      return { ok: true, value: paged };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error : new Error(String(error)) };
    }
  }

  async exportSnapshot(options?: ExportSnapshotOptions): Promise<Result<GraphSnapshot>> {
    try {
      let nodes = Array.from(this.nodes.values());
      if (options?.scope === 'knowledge') {
        nodes = nodes.filter(node => (node.metadata as Record<string, unknown>)?.['scope'] !== 'operational');
      }
      const sortedNodes = sortNodes(nodes);
      const nodeIds = new Set(sortedNodes.map(node => node.id));
      let edges = Array.from(this.edges.values()).filter(edge => nodeIds.has(edge.subject) && nodeIds.has(edge.object));
      edges = sortEdges(edges);
      return { ok: true, value: { nodes: sortedNodes, edges } };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error : new Error(String(error)) };
    }
  }

  async exportGephi(options: ExportGephiOptions = {}): Promise<Result<GephiExport>> {
    try {
      let edges = Array.from(this.edges.values());
      if (options.predicates && options.predicates.length > 0) {
        const predicateSet = new Set(options.predicates);
        edges = edges.filter(e => predicateSet.has(e.predicate));
      }

      const referencedIds = new Set<string>();
      for (const edge of edges) {
        referencedIds.add(edge.subject);
        referencedIds.add(edge.object);
      }

      let nodes = Array.from(this.nodes.values());
      if (options.nodeTypes && options.nodeTypes.length > 0) {
        const typeSet = new Set(options.nodeTypes);
        nodes = nodes.filter(n => typeSet.has(n.type));
      }
      // Include only nodes referenced by filtered edges, or all matching type filter if no predicates
      if (options.predicates && options.predicates.length > 0) {
        nodes = nodes.filter(n => referencedIds.has(n.id));
      }

      const gephiNodes: GephiNode[] = sortNodes(nodes).map(n => ({
        id: n.id,
        ...(options.includeLabels ? { label: n.label } : {}),
        type: n.type,
        createdAt: n.createdAt,
      }));

      // Filter edges to only those where both endpoints exist in the filtered node set
      const includedNodeIds = new Set(nodes.map(n => n.id));
      edges = edges.filter(e => includedNodeIds.has(e.subject) && includedNodeIds.has(e.object));

      const gephiEdges: GephiEdge[] = sortEdges(edges).map(e => ({
        source: e.subject,
        target: e.object,
        predicate: e.predicate,
        weight: 1,
        createdAt: e.createdAt,
      }));

      return { ok: true, value: { nodes: gephiNodes, edges: gephiEdges } };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error : new Error(String(error)) };
    }
  }

  async getGraphStats(options: GetGraphStatsOptions = {}): Promise<Result<GraphStats>> {
    try {
      const topN = options.topN ?? 10;
      const nodeCounts: Record<string, number> = {};
      const claimStateCounts: Record<string, number> = {};
      for (const node of this.nodes.values()) {
        nodeCounts[node.type] = (nodeCounts[node.type] ?? 0) + 1;
        if (node.type === 'Claim') {
          const state = (node.metadata as Record<string, unknown>)?.['state'];
          const stateStr = typeof state === 'string' ? state : 'unknown';
          claimStateCounts[stateStr] = (claimStateCounts[stateStr] ?? 0) + 1;
        }
      }

      const edgeCounts: Record<string, number> = {};
      const inDeg = new Map<string, number>();
      const outDeg = new Map<string, number>();
      for (const edge of this.edges.values()) {
        edgeCounts[edge.predicate] = (edgeCounts[edge.predicate] ?? 0) + 1;
        inDeg.set(edge.object, (inDeg.get(edge.object) ?? 0) + 1);
        outDeg.set(edge.subject, (outDeg.get(edge.subject) ?? 0) + 1);
      }

      const allIds = new Set<string>([...inDeg.keys(), ...outDeg.keys()]);
      const degreeEntries = Array.from(allIds).map(id => ({
        id,
        inDegree: inDeg.get(id) ?? 0,
        outDegree: outDeg.get(id) ?? 0,
        total: (inDeg.get(id) ?? 0) + (outDeg.get(id) ?? 0),
      }));
      degreeEntries.sort((a, b) => b.total - a.total || a.id.localeCompare(b.id));

      const topDegreeNodes = degreeEntries.slice(0, topN).map(entry => {
        const node = this.nodes.get(entry.id);
        return {
          id: entry.id,
          type: node?.type ?? 'unknown',
          inDegree: entry.inDegree,
          outDegree: entry.outDegree,
        };
      });

      return {
        ok: true,
        value: {
          nodeCounts,
          edgeCounts,
          topDegreeNodes,
          ...(Object.keys(claimStateCounts).length > 0 ? { claimStateCounts } : {}),
        },
      };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error : new Error(String(error)) };
    }
  }

  async close(): Promise<void> {
    this.nodes.clear();
    this.edges.clear();
  }

  /**
   * Get all nodes (for testing/debugging).
   */
  getAllNodes(): GraphNode[] {
    return Array.from(this.nodes.values());
  }

  /**
   * Get all edges (for testing/debugging).
   */
  getAllEdges(): GraphEdge[] {
    return Array.from(this.edges.values());
  }
}
