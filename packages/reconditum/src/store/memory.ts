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
} from './types.js';
import type {
  GraphNode,
  GraphEdge,
  CreateNodeInput,
  CreateEdgeInput,
  UpdateNodeInput,
} from '../schema/index.js';
import { GraphNode as GraphNodeSchema, GraphEdge as GraphEdgeSchema } from '../schema/index.js';

/**
 * Get current ISO timestamp.
 */
function now(): string {
  return new Date().toISOString();
}

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

  async createNode(input: CreateNodeInput): Promise<Result<GraphNode>> {
    try {
      const timestamp = now();
      const node: GraphNode = {
        ...input,
        metadata: input.metadata ?? {},
        createdAt: timestamp,
        updatedAt: timestamp,
      };

      // Validate the complete node
      const validated = GraphNodeSchema.parse(node);
      this.nodes.set(validated.id, validated);

      return { ok: true, value: validated };
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

  async updateNode(id: string, input: UpdateNodeInput): Promise<Result<GraphNode>> {
    try {
      const existing = this.nodes.get(id);
      if (!existing) {
        return { ok: false, error: new Error(`Node not found: ${id}`) };
      }

      const updated: GraphNode = {
        ...existing,
        ...input,
        id: existing.id,
        createdAt: existing.createdAt,
        updatedAt: now(),
      };

      const validated = GraphNodeSchema.parse(updated);
      this.nodes.set(id, validated);

      return { ok: true, value: validated };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error : new Error(String(error)) };
    }
  }

  async deleteNode(id: string): Promise<Result<void>> {
    try {
      this.nodes.delete(id);
      return { ok: true, value: undefined };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error : new Error(String(error)) };
    }
  }

  async queryNodes(options: QueryNodesOptions = {}): Promise<Result<GraphNode[]>> {
    try {
      let nodes = Array.from(this.nodes.values());

      // Apply type filter
      if (options.type) {
        nodes = nodes.filter(n => n.type === options.type);
      }

      // Apply pagination
      const offset = options.offset ?? 0;
      const limit = options.limit ?? nodes.length;
      nodes = nodes.slice(offset, offset + limit);

      return { ok: true, value: nodes };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error : new Error(String(error)) };
    }
  }

  async createEdge(input: CreateEdgeInput): Promise<Result<GraphEdge>> {
    try {
      const edge: GraphEdge = {
        ...input,
        metadata: input.metadata ?? {},
        createdAt: now(),
      };

      const validated = GraphEdgeSchema.parse(edge);
      const key = edgeKey(validated.subject, validated.predicate, validated.object);
      this.edges.set(key, validated);

      return { ok: true, value: validated };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error : new Error(String(error)) };
    }
  }

  async getEdges(options: QueryEdgesOptions = {}): Promise<Result<GraphEdge[]>> {
    try {
      let edges = Array.from(this.edges.values());

      // Apply filters
      if (options.subject) {
        edges = edges.filter(e => e.subject === options.subject);
      }
      if (options.predicate) {
        edges = edges.filter(e => e.predicate === options.predicate);
      }
      if (options.object) {
        edges = edges.filter(e => e.object === options.object);
      }

      // Apply limit (allow limit=0)
      if (options.limit !== undefined) {
        edges = edges.slice(0, options.limit);
      }

      return { ok: true, value: edges };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error : new Error(String(error)) };
    }
  }

  async deleteEdge(subject: string, predicate: string, object: string): Promise<Result<void>> {
    try {
      const key = edgeKey(subject, predicate, object);
      this.edges.delete(key);
      return { ok: true, value: undefined };
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
