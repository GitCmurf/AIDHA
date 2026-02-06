/**
 * LevelGraph store implementation.
 *
 * Uses LevelGraph (backed by LevelDB) for embedded graph storage.
 * Nodes are stored as special triples with _node predicate.
 */
import levelgraph from 'levelgraph';
import { MemoryLevel } from 'memory-level';
import { ClassicLevel } from 'classic-level';

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
  LevelGraphTriple,
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

// LevelGraph type declarations (library lacks proper TS types)
interface LevelGraphDB {
  put(triple: LevelGraphTriple | LevelGraphTriple[], callback: (err?: Error) => void): void;
  get(pattern: Partial<LevelGraphTriple>, callback: (err: Error | null, list: LevelGraphTriple[]) => void): void;
  del(triple: LevelGraphTriple, callback: (err?: Error) => void): void;
  close(callback: (err?: Error) => void): void;
}

/** Internal predicate for storing node data as triples */
const NODE_PREDICATE = '_node';
const NODE_OBJECT = '_data';

/**
 * Convert a triple to a GraphEdge.
 */
function tripleToEdge(triple: LevelGraphTriple): GraphEdge | null {
  // Skip internal node triples
  if (triple.predicate === NODE_PREDICATE) {
    return null;
  }

  const result = GraphEdgeSchema.safeParse({
    subject: triple.subject,
    predicate: triple.predicate,
    object: triple.object,
    metadata: triple['metadata'] ?? {},
    createdAt: triple['createdAt'],
  });

  return result.success ? result.data : null;
}

/**
 * Promisify LevelGraph operations.
 */
function promisify<T>(
  fn: (callback: (err: Error | null, result?: T) => void) => void
): Promise<T> {
  return new Promise((resolve, reject) => {
    fn((err, result) => {
      if (err) reject(err);
      else resolve(result as T);
    });
  });
}

function promisifyVoid(
  fn: (callback: (err?: Error) => void) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    fn((err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

/**
 * LevelGraph-based graph store implementation.
 */
export class LevelGraphStore implements GraphStore {
  private db: LevelGraphDB;

  constructor(db: LevelGraphDB) {
    this.db = db;
  }

  /**
   * Create a new LevelGraph store with file-based persistence.
   *
   * @param path - File path for persistent storage
   */
  static async create(path: string): Promise<LevelGraphStore> {
    const level = new ClassicLevel(path, { valueEncoding: 'json' });
    const db = levelgraph(level) as unknown as LevelGraphDB;
    return new LevelGraphStore(db);
  }

  /**
   * Create a new in-memory LevelGraph store (for testing).
   */
  static createInMemory(): LevelGraphStore {
    const level = new MemoryLevel({ valueEncoding: 'json' });
    const db = levelgraph(level) as unknown as LevelGraphDB;
    return new LevelGraphStore(db);
  }


  private async deleteNodeTriple(id: string): Promise<void> {
    const triple: LevelGraphTriple = {
      subject: id,
      predicate: NODE_PREDICATE,
      object: NODE_OBJECT,
    };
    await promisifyVoid((cb) => this.db.del(triple, cb));
  }

  async upsertNode(
    type: NodeType,
    id: string,
    data: NodeDataInput,
    options?: UpsertNodeOptions
  ): Promise<Result<UpsertNodeResult>> {
    try {
      const existingResult = await this.getNode(id);
      if (!existingResult.ok) {
        return existingResult;
      }
      const existing = existingResult.value;
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
        const triple: LevelGraphTriple = {
          subject: validated.id,
          predicate: NODE_PREDICATE,
          object: NODE_OBJECT,
          ...validated,
        };
        await promisifyVoid((cb) => this.db.put(triple, cb));
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
      const triple: LevelGraphTriple = {
        subject: validated.id,
        predicate: NODE_PREDICATE,
        object: NODE_OBJECT,
        ...validated,
      };
      await promisifyVoid((cb) => this.db.put(triple, cb));
      return { ok: true, value: { node: validated, created: false, updated: true, noop: false } };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error : new Error(String(error)) };
    }
  }

  async getNode(id: string): Promise<Result<GraphNode | null>> {
    try {
      const triples = await promisify<LevelGraphTriple[]>((cb) =>
        this.db.get({ subject: id, predicate: NODE_PREDICATE }, cb)
      );

      if (triples.length === 0) {
        return { ok: true, value: null };
      }

      const triple = triples[0];
      if (!triple) {
        return { ok: true, value: null };
      }

      const node = GraphNodeSchema.parse({
        id: triple['id'],
        type: triple['type'],
        label: triple['label'],
        content: triple['content'],
        metadata: triple['metadata'],
        createdAt: triple['createdAt'],
        updatedAt: triple['updatedAt'],
      });

      return { ok: true, value: node };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error : new Error(String(error)) };
    }
  }

  async deleteNode(id: string, options?: DeleteNodeOptions): Promise<Result<void>> {
    try {
      await this.deleteNodeTriple(id);
      if (options?.cascade) {
        const subjectTriples = await promisify<LevelGraphTriple[]>((cb) =>
          this.db.get({ subject: id }, cb)
        );
        const objectTriples = await promisify<LevelGraphTriple[]>((cb) =>
          this.db.get({ object: id }, cb)
        );
        const triples = [...subjectTriples, ...objectTriples].filter(triple => triple.predicate !== NODE_PREDICATE);
        for (const triple of triples) {
          await promisifyVoid((cb) => this.db.del(triple, cb));
        }
      }
      return { ok: true, value: undefined };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error : new Error(String(error)) };
    }
  }

  async queryNodes(options: QueryNodesOptions = {}): Promise<Result<QueryResult<GraphNode>>> {
    try {
      const triples = await promisify<LevelGraphTriple[]>((cb) =>
        this.db.get({ predicate: NODE_PREDICATE }, cb)
      );

      const nodes: GraphNode[] = [];

      for (const triple of triples) {
        try {
          const node = GraphNodeSchema.parse({
            id: triple['id'],
            type: triple['type'],
            label: triple['label'],
            content: triple['content'],
            metadata: triple['metadata'],
            createdAt: triple['createdAt'],
            updatedAt: triple['updatedAt'],
          });
          if (options.type && node.type !== options.type) {
            continue;
          }
          if (!nodeMatchesFilters(node, options.filters)) {
            continue;
          }
          nodes.push(node);
        } catch {
          continue;
        }
      }

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
      const pattern: Partial<LevelGraphTriple> = { subject, predicate, object };
      const existingTriples = await promisify<LevelGraphTriple[]>((cb) =>
        this.db.get(pattern, cb)
      );
      const existingEdge = existingTriples.map(tripleToEdge).find(edge => edge !== null) ?? null;
      const metadata = data.metadata ?? {};

      if (!existingEdge) {
        const edge: GraphEdge = {
          subject,
          predicate,
          object,
          metadata,
          createdAt: nowIso(),
        };
        const validated = GraphEdgeSchema.parse(edge);
        const triple: LevelGraphTriple = {
          subject: validated.subject,
          predicate: validated.predicate,
          object: validated.object,
          metadata: validated.metadata,
          createdAt: validated.createdAt,
        };
        await promisifyVoid((cb) => this.db.put(triple, cb));
        return { ok: true, value: { edge: validated, created: true, updated: false, noop: false } };
      }

      const shouldDetectNoop = options?.detectNoop ?? true;
      if (shouldDetectNoop && deepEqual(existingEdge.metadata ?? {}, metadata)) {
        return { ok: true, value: { edge: existingEdge, created: false, updated: false, noop: true } };
      }

      const updated: GraphEdge = {
        ...existingEdge,
        subject,
        predicate,
        object,
        metadata,
        createdAt: existingEdge.createdAt,
      };
      const validated = GraphEdgeSchema.parse(updated);
      await promisifyVoid((cb) => this.db.del({ subject, predicate, object }, cb));
      const triple: LevelGraphTriple = {
        subject: validated.subject,
        predicate: validated.predicate,
        object: validated.object,
        metadata: validated.metadata,
        createdAt: validated.createdAt,
      };
      await promisifyVoid((cb) => this.db.put(triple, cb));
      return { ok: true, value: { edge: validated, created: false, updated: true, noop: false } };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error : new Error(String(error)) };
    }
  }

  async getEdges(options: QueryEdgesOptions = {}): Promise<Result<QueryResult<GraphEdge>>> {
    try {
      const pattern: Partial<LevelGraphTriple> = {};
      if (options.subject) pattern.subject = options.subject;
      if (options.predicate) pattern.predicate = options.predicate;
      if (options.object) pattern.object = options.object;

      const triples = await promisify<LevelGraphTriple[]>((cb) =>
        this.db.get(pattern, cb)
      );

      const edges: GraphEdge[] = [];
      for (const triple of triples) {
        const edge = tripleToEdge(triple);
        if (edge) {
          edges.push(edge);
        }
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
      const nodesResult = await this.queryNodes({});
      if (!nodesResult.ok) return { ok: false, error: nodesResult.error };
      let nodes = nodesResult.value.items;
      if (options?.scope === 'knowledge') {
        nodes = nodes.filter(node => (node.metadata as Record<string, unknown>)?.['scope'] !== 'operational');
      }
      const sortedNodes = sortNodes(nodes);
      const nodeIds = new Set(sortedNodes.map(node => node.id));
      const edgesResult = await this.getEdges({});
      if (!edgesResult.ok) return { ok: false, error: edgesResult.error };
      let edges = edgesResult.value.items.filter(edge => nodeIds.has(edge.subject) && nodeIds.has(edge.object));
      edges = sortEdges(edges);
      return { ok: true, value: { nodes: sortedNodes, edges } };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error : new Error(String(error)) };
    }
  }

  async close(): Promise<void> {
    await promisifyVoid((cb) => this.db.close(cb));
  }
}
