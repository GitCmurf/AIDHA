/**
 * In-memory graph store implementation.
 *
 * Simple Map-based storage for MVP and testing.
 * Can be replaced with LevelGraph/Neo4j later via the adapter pattern.
 */
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

/**
 * In-memory graph store for MVP and testing.
 */
export class InMemoryStore implements GraphStore {
  private nodes = new Map<string, GraphNode>();
  private edges = new Map<string, GraphEdge>();

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
        nodes = nodes.filter(node => (node.metadata as Record<string, unknown>)?.scope !== 'operational');
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
