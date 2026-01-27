/**
 * Store types - abstractions for graph storage backends.
 *
 * Enables swapping LevelGraph for Neo4j/ArangoDB later.
 */
import type { GraphNode, GraphEdge, CreateNodeInput, CreateEdgeInput, UpdateNodeInput } from '../schema/index.js';

/**
 * Result wrapper for operations that may fail.
 */
export type Result<T, E = Error> =
  | { ok: true; value: T }
  | { ok: false; error: E };

/**
 * Query options for node retrieval.
 */
export interface QueryNodesOptions {
  /** Filter by node type */
  type?: string;
  /** Maximum results to return */
  limit?: number;
  /** Offset for pagination */
  offset?: number;
}

/**
 * Query options for edge retrieval.
 */
export interface QueryEdgesOptions {
  /** Filter by subject node ID */
  subject?: string;
  /** Filter by predicate type */
  predicate?: string;
  /** Filter by object node ID */
  object?: string;
  /** Maximum results to return */
  limit?: number;
}

/**
 * GraphStore interface - abstraction over graph storage backends.
 *
 * Implementations must handle node and edge CRUD operations.
 */
export interface GraphStore {
  // Node operations
  createNode(input: CreateNodeInput): Promise<Result<GraphNode>>;
  getNode(id: string): Promise<Result<GraphNode | null>>;
  updateNode(id: string, input: UpdateNodeInput): Promise<Result<GraphNode>>;
  deleteNode(id: string): Promise<Result<void>>;
  queryNodes(options?: QueryNodesOptions): Promise<Result<GraphNode[]>>;

  // Edge operations
  createEdge(input: CreateEdgeInput): Promise<Result<GraphEdge>>;
  getEdges(options?: QueryEdgesOptions): Promise<Result<GraphEdge[]>>;
  deleteEdge(subject: string, predicate: string, object: string): Promise<Result<void>>;

  // Lifecycle
  close(): Promise<void>;
}
