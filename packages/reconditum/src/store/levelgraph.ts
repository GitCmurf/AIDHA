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
} from './types.js';
import type {
  GraphNode,
  GraphEdge,
  CreateNodeInput,
  CreateEdgeInput,
  UpdateNodeInput,
  LevelGraphTriple,
} from '../schema/index.js';
import { GraphNode as GraphNodeSchema, GraphEdge as GraphEdgeSchema } from '../schema/index.js';

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
 * Get current ISO timestamp.
 */
function now(): string {
  return new Date().toISOString();
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

      // Store node as a special triple
      const triple: LevelGraphTriple = {
        subject: validated.id,
        predicate: NODE_PREDICATE,
        object: NODE_OBJECT,
        ...validated,
      };

      await promisifyVoid((cb) => this.db.put(triple, cb));
      return { ok: true, value: validated };
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

  async updateNode(id: string, input: UpdateNodeInput): Promise<Result<GraphNode>> {
    try {
      // Get existing node
      const existing = await this.getNode(id);
      if (!existing.ok) {
        return existing;
      }
      if (!existing.value) {
        return { ok: false, error: new Error(`Node not found: ${id}`) };
      }

      // Merge updates
      const updated: GraphNode = {
        ...existing.value,
        ...input,
        id: existing.value.id, // Prevent ID change
        createdAt: existing.value.createdAt, // Preserve creation time
        updatedAt: now(),
      };

      // Delete old triple
      await this.deleteNode(id);

      // Store updated node
      const triple: LevelGraphTriple = {
        subject: updated.id,
        predicate: NODE_PREDICATE,
        object: NODE_OBJECT,
        ...updated,
      };

      await promisifyVoid((cb) => this.db.put(triple, cb));
      return { ok: true, value: updated };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error : new Error(String(error)) };
    }
  }

  async deleteNode(id: string): Promise<Result<void>> {
    try {
      const triple: LevelGraphTriple = {
        subject: id,
        predicate: NODE_PREDICATE,
        object: NODE_OBJECT,
      };
      await promisifyVoid((cb) => this.db.del(triple, cb));
      return { ok: true, value: undefined };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error : new Error(String(error)) };
    }
  }

  async queryNodes(options: QueryNodesOptions = {}): Promise<Result<GraphNode[]>> {
    try {
      const triples = await promisify<LevelGraphTriple[]>((cb) =>
        this.db.get({ predicate: NODE_PREDICATE }, cb)
      );

      let nodes: GraphNode[] = [];

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

          // Apply type filter
          if (options.type && node.type !== options.type) {
            continue;
          }

          nodes.push(node);
        } catch {
          // Skip malformed entries
        }
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

      const triple: LevelGraphTriple = {
        subject: validated.subject,
        predicate: validated.predicate,
        object: validated.object,
        metadata: validated.metadata,
        createdAt: validated.createdAt,
      };

      await promisifyVoid((cb) => this.db.put(triple, cb));
      return { ok: true, value: validated };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error : new Error(String(error)) };
    }
  }

  async getEdges(options: QueryEdgesOptions = {}): Promise<Result<GraphEdge[]>> {
    try {
      const pattern: Partial<LevelGraphTriple> = {};
      if (options.subject) pattern.subject = options.subject;
      if (options.predicate) pattern.predicate = options.predicate;
      if (options.object) pattern.object = options.object;

      const triples = await promisify<LevelGraphTriple[]>((cb) =>
        this.db.get(pattern, cb)
      );

      let edges: GraphEdge[] = [];
      for (const triple of triples) {
        const edge = tripleToEdge(triple);
        if (edge) {
          edges.push(edge);
        }
      }

      // Apply limit
      if (options.limit) {
        edges = edges.slice(0, options.limit);
      }

      return { ok: true, value: edges };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error : new Error(String(error)) };
    }
  }

  async deleteEdge(subject: string, predicate: string, object: string): Promise<Result<void>> {
    try {
      const triple: LevelGraphTriple = { subject, predicate, object };
      await promisifyVoid((cb) => this.db.del(triple, cb));
      return { ok: true, value: undefined };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error : new Error(String(error)) };
    }
  }

  async close(): Promise<void> {
    await promisifyVoid((cb) => this.db.close(cb));
  }
}
