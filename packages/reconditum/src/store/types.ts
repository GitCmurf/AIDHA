/**
 * Store types - abstractions for graph storage backends.
 *
 * Enables swapping LevelGraph for Neo4j/ArangoDB later.
 */
import type {
  GraphNode,
  GraphEdge,
  CreateNodeInput,
  CreateEdgeInput,
  NodeType,
  Predicate,
} from '../schema/index.js';

/**
 * Result wrapper for operations that may fail.
 */
export type Result<T, E = Error> =
  | { ok: true; value: T }
  | { ok: false; error: E };

/**
 * Query options for node retrieval.
 */
export type SortDirection = 'asc' | 'desc';

export type NodeSortField = 'type' | 'id' | 'label' | 'createdAt' | 'updatedAt';

export type EdgeSortField = 'subject' | 'predicate' | 'object' | 'createdAt';

export interface SortOption<TField extends string> {
  field: TField;
  direction?: SortDirection;
}

export interface QueryNodesOptions {
  type?: NodeType;
  filters?: Record<string, unknown>;
  sort?: SortOption<NodeSortField>;
  limit?: number;
  cursor?: string;
}

/**
 * Query options for edge retrieval.
 */
export interface QueryEdgesOptions {
  subject?: string;
  predicate?: Predicate;
  object?: string;
  sort?: SortOption<EdgeSortField>;
  limit?: number;
  cursor?: string;
}

export interface QueryResult<T> {
  items: T[];
  nextCursor?: string;
}

export type NodeDataInput = Omit<CreateNodeInput, 'id' | 'type'>;

export type EdgeDataInput = Omit<CreateEdgeInput, 'subject' | 'predicate' | 'object'>;

export interface UpsertNodeOptions {
  detectNoop?: boolean;
}

export interface UpsertEdgeOptions {
  detectNoop?: boolean;
}

export interface UpsertNodeResult {
  node: GraphNode;
  created: boolean;
  updated: boolean;
  noop: boolean;
}

export interface UpsertEdgeResult {
  edge: GraphEdge;
  created: boolean;
  updated: boolean;
  noop: boolean;
}

export interface DeleteNodeOptions {
  cascade?: boolean;
}

export type ExportScope = 'knowledge' | 'full';

export interface ExportSnapshotOptions {
  scope?: ExportScope;
}

export interface GraphSnapshot {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

/**
 * Gephi CSV export types.
 */
export interface GephiNode {
  id: string;
  label?: string;
  type: string;
  createdAt: string;
}

export interface GephiEdge {
  source: string;
  target: string;
  predicate: string;
  weight: number;
  createdAt: string;
}

export interface ExportGephiOptions {
  predicates?: Predicate[];
  nodeTypes?: NodeType[];
  includeLabels?: boolean;
}

export interface GephiExport {
  nodes: GephiNode[];
  edges: GephiEdge[];
}

/**
 * Graph statistics types.
 */
export interface GraphStats {
  nodeCounts: Record<string, number>;
  edgeCounts: Record<string, number>;
  topDegreeNodes: Array<{
    id: string;
    type: string;
    inDegree: number;
    outDegree: number;
  }>;
  claimStateCounts?: Record<string, number>;
}

export interface GetGraphStatsOptions {
  topN?: number;
}

export interface TransactionCapableStore {
  runInTransaction<T>(work: () => Promise<Result<T>>): Promise<Result<T>>;
}

/**
 * GraphStore interface - abstraction over graph storage backends.
 *
 * Implementations must handle node and edge CRUD operations.
 */
export interface GraphStore {
  upsertNode(
    type: NodeType,
    id: string,
    data: NodeDataInput,
    options?: UpsertNodeOptions
  ): Promise<Result<UpsertNodeResult>>;
  getNode(id: string): Promise<Result<GraphNode | null>>;
  queryNodes(options?: QueryNodesOptions): Promise<Result<QueryResult<GraphNode>>>;
  upsertEdge(
    subject: string,
    predicate: Predicate,
    object: string,
    data: EdgeDataInput,
    options?: UpsertEdgeOptions
  ): Promise<Result<UpsertEdgeResult>>;
  getEdges(options?: QueryEdgesOptions): Promise<Result<QueryResult<GraphEdge>>>;
  deleteNode(id: string, options?: DeleteNodeOptions): Promise<Result<void>>;
  exportSnapshot(options?: ExportSnapshotOptions): Promise<Result<GraphSnapshot>>;
  exportGephi(options?: ExportGephiOptions): Promise<Result<GephiExport>>;
  getGraphStats(options?: GetGraphStatsOptions): Promise<Result<GraphStats>>;
  runInTransaction?<T>(work: () => Promise<Result<T>>): Promise<Result<T>>;
  close(): Promise<void>;
}
