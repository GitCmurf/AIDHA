// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 Colin Farmer (GitCmurf)

import { AsyncLocalStorage } from 'node:async_hooks';
import { createRequire } from 'node:module';
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
import type { GraphNode, GraphEdge, NodeType, Predicate } from '../schema/index.js';
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
  stableStringify,
} from './utils.js';

type StatementSync = {
  run: (...args: unknown[]) => void;
  get: (...args: unknown[]) => unknown;
  all: (...args: unknown[]) => unknown[];
};

type DatabaseSyncLike = {
  exec: (sql: string) => void;
  prepare: (sql: string) => StatementSync;
  close: () => void;
};

type DatabaseSyncCtor = new (path: string) => DatabaseSyncLike;

let cachedCtor: DatabaseSyncCtor | null = null;

function getDatabaseSyncCtor(): DatabaseSyncCtor {
  if (!cachedCtor) {
    const require = createRequire(import.meta.url);
    const mod = require('node:sqlite') as { DatabaseSync: DatabaseSyncCtor };
    cachedCtor = mod.DatabaseSync;
  }
  return cachedCtor;
}

type NodeRow = {
  id: string;
  type: string;
  label: string;
  content: string | null;
  metadata: string | null;
  created_at: string;
  updated_at: string;
};

type EdgeRow = {
  subject: string;
  predicate: string;
  object: string;
  metadata: string | null;
  created_at: string;
};

function parseMetadata(raw: string | null): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return {};
  } catch {
    return {};
  }
}

function serializeMetadata(metadata: Record<string, unknown>): string {
  return stableStringify(metadata);
}

export class SQLiteStore implements GraphStore {
  private db: DatabaseSyncLike;
  private ftsEnabled = false;
  private ftsTypes = new Set<NodeType>(['Claim', 'Excerpt', 'Resource']);
  private transactionDepth = 0;
  private transactionQueue: Promise<void> = Promise.resolve();
  private transactionOwner?: symbol;
  private readonly transactionContext = new AsyncLocalStorage<symbol>();

  constructor(db: DatabaseSyncLike) {
    this.db = db;
    this.initialize();
  }

  static open(path: string): SQLiteStore {
    const DatabaseSync = getDatabaseSyncCtor();
    const db = new DatabaseSync(path);
    return new SQLiteStore(db);
  }

  static createInMemory(): SQLiteStore {
    const DatabaseSync = getDatabaseSyncCtor();
    const db = new DatabaseSync(':memory:');
    return new SQLiteStore(db);
  }

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
      const ownerToken = Symbol('sqlite-store-transaction');
      this.transactionOwner = ownerToken;
      try {
        this.db.exec('BEGIN IMMEDIATE');
      } catch (error) {
        this.transactionOwner = undefined;
        return { ok: false, error: error instanceof Error ? error : new Error(String(error)) };
      }

      this.transactionDepth += 1;
      try {
        const result = await this.transactionContext.run(ownerToken, async () => work());
        if (!result.ok) {
          try {
            this.db.exec('ROLLBACK');
          } catch {
            // Preserve the original operation error when rollback also fails.
          }
          return result;
        }
        try {
          this.db.exec('COMMIT');
        } catch (commitError) {
          try {
            this.db.exec('ROLLBACK');
          } catch {
            // Ignore rollback failure after commit failure.
          }
          return {
            ok: false,
            error: commitError instanceof Error
              ? new Error(`Transaction commit failed: ${commitError.message}`)
              : new Error(`Transaction commit failed: ${String(commitError)}`),
          };
        }
        return result;
      } catch (error) {
        try {
          this.db.exec('ROLLBACK');
        } catch {
          // Ignore rollback failure so we can return the original error.
        }
        return { ok: false, error: error instanceof Error ? error : new Error(String(error)) };
      } finally {
        this.transactionDepth -= 1;
        if (this.transactionDepth === 0) {
          this.transactionOwner = undefined;
        }
      }
    });
  }

  private initialize(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS nodes (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        label TEXT NOT NULL,
        content TEXT,
        metadata TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS edges (
        subject TEXT NOT NULL,
        predicate TEXT NOT NULL,
        object TEXT NOT NULL,
        metadata TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (subject, predicate, object)
      )
    `);
    this.db.exec(`CREATE INDEX IF NOT EXISTS nodes_type_idx ON nodes (type)`);
    this.db.exec(`CREATE INDEX IF NOT EXISTS edges_subject_predicate_idx ON edges (subject, predicate)`);
    this.db.exec(`CREATE INDEX IF NOT EXISTS edges_predicate_object_idx ON edges (predicate, object)`);
    this.db.exec(`CREATE INDEX IF NOT EXISTS edges_subject_object_idx ON edges (subject, object)`);
    this.initializeViews();
    this.initializeFts();
  }

  private initializeViews(): void {
    this.db.exec(`
      CREATE VIEW IF NOT EXISTS v_nodes AS
      SELECT
        id,
        type,
        label,
        created_at AS createdAt,
        updated_at AS updatedAt,
        json_extract(metadata, '$.title') AS title,
        json_extract(metadata, '$.state') AS state,
        json_extract(metadata, '$.videoId') AS videoId,
        json_extract(metadata, '$.source') AS source
      FROM nodes
    `);
    this.db.exec(`
      CREATE VIEW IF NOT EXISTS v_edges AS
      SELECT
        subject,
        predicate,
        object,
        created_at AS createdAt,
        json_extract(metadata, '$.weight') AS weight
      FROM edges
    `);
    this.db.exec(`
      CREATE VIEW IF NOT EXISTS v_claims_with_sources AS
      SELECT
        n.id AS claimId,
        n.label AS claimLabel,
        n.content AS claimContent,
        json_extract(n.metadata, '$.state') AS state,
        json_extract(n.metadata, '$.videoId') AS videoId,
        e.object AS sourceId,
        src.label AS sourceLabel,
        src.type AS sourceType,
        n.created_at AS createdAt
      FROM nodes n
      LEFT JOIN edges e ON e.subject = n.id AND e.predicate = 'claimDerivedFrom'
      LEFT JOIN nodes src ON src.id = e.object
      WHERE n.type = 'Claim'
    `);
  }

  private initializeFts(): void {
    try {
      this.db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS nodes_fts
        USING fts5(id, type, label, content, tokenize = 'porter');
      `);
      this.ftsEnabled = true;
      this.rebuildFtsIfNeeded();
    } catch {
      this.ftsEnabled = false;
    }
  }

  private rebuildFtsIfNeeded(): void {
    if (!this.ftsEnabled) return;
    try {
      const nodeCount = this.db.prepare('SELECT COUNT(*) as count FROM nodes').get() as { count: number };
      const ftsCount = this.db.prepare('SELECT COUNT(*) as count FROM nodes_fts').get() as { count: number };
      if (ftsCount.count >= nodeCount.count) return;
      this.db.exec('DELETE FROM nodes_fts');
      this.db.exec(
        `INSERT INTO nodes_fts (id, type, label, content)
         SELECT id, type, label, COALESCE(content, '')
         FROM nodes
         WHERE type IN ('Claim', 'Excerpt', 'Resource')`
      );
    } catch {
      this.ftsEnabled = false;
    }
  }

  private syncFtsNode(node: GraphNode): void {
    if (!this.ftsEnabled) return;
    try {
      this.db.prepare('DELETE FROM nodes_fts WHERE id = ?').run(node.id);
      if (!this.ftsTypes.has(node.type)) return;
      this.db.prepare(
        'INSERT INTO nodes_fts (id, type, label, content) VALUES (?, ?, ?, ?)'
      ).run(
        node.id,
        node.type,
        node.label,
        node.content ?? ''
      );
    } catch {
      this.ftsEnabled = false;
    }
  }

  supportsFts(): boolean {
    return this.ftsEnabled;
  }

  searchText(query: string, types?: NodeType[]): Result<Set<string>> {
    if (!this.ftsEnabled) {
      return { ok: false, error: new Error('FTS not enabled') };
    }
    const sanitized = query.replace(/["']/g, ' ').trim();
    if (!sanitized) {
      return { ok: true, value: new Set() };
    }
    const params: unknown[] = [sanitized];
    let typeClause = '';
    if (types && types.length > 0) {
      typeClause = `AND type IN (${types.map(() => '?').join(', ')})`;
      params.push(...types);
    }
    try {
      const rows = this.db.prepare(
        `SELECT id FROM nodes_fts WHERE nodes_fts MATCH ? ${typeClause}`
      ).all(...params) as Array<{ id: string }>;
      return { ok: true, value: new Set(rows.map(row => row.id)) };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error : new Error(String(error)),
      };
    }
  }

  async upsertNode(
    type: NodeType,
    id: string,
    data: NodeDataInput,
    options?: UpsertNodeOptions
  ): Promise<Result<UpsertNodeResult>> {
    try {
      const existingResult = await this.getNode(id);
      if (!existingResult.ok) return existingResult;
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
        this.db.prepare(
          'INSERT INTO nodes (id, type, label, content, metadata, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
        ).run(
          validated.id,
          validated.type,
          validated.label,
          validated.content ?? null,
          serializeMetadata(validated.metadata ?? {}),
          validated.createdAt,
          validated.updatedAt
        );
        this.syncFtsNode(validated);
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
      this.db.prepare(
        'UPDATE nodes SET type = ?, label = ?, content = ?, metadata = ?, updated_at = ? WHERE id = ?'
      ).run(
        validated.type,
        validated.label,
        validated.content ?? null,
        serializeMetadata(validated.metadata ?? {}),
        validated.updatedAt,
        validated.id
      );
      this.syncFtsNode(validated);
      return { ok: true, value: { node: validated, created: false, updated: true, noop: false } };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error : new Error(String(error)) };
    }
  }

  async getNode(id: string): Promise<Result<GraphNode | null>> {
    try {
      const row = this.db.prepare(
        'SELECT id, type, label, content, metadata, created_at, updated_at FROM nodes WHERE id = ?'
      ).get(id) as NodeRow | undefined;
      if (!row) return { ok: true, value: null };
      const node = GraphNodeSchema.parse({
        id: row.id,
        type: row.type,
        label: row.label,
        content: row.content ?? undefined,
        metadata: parseMetadata(row.metadata),
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      });
      return { ok: true, value: node };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error : new Error(String(error)) };
    }
  }

  async queryNodes(options: QueryNodesOptions = {}): Promise<Result<QueryResult<GraphNode>>> {
    try {
      const clauses: string[] = [];
      const params: unknown[] = [];
      if (options.type) {
        clauses.push('type = ?');
        params.push(options.type);
      }
      const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
      const rows = this.db.prepare(
        `SELECT id, type, label, content, metadata, created_at, updated_at FROM nodes ${where}`
      ).all(...params) as NodeRow[];
      const nodes: GraphNode[] = [];
      for (const row of rows) {
        const parsed = GraphNodeSchema.safeParse({
          id: row.id,
          type: row.type,
          label: row.label,
          content: row.content ?? undefined,
          metadata: parseMetadata(row.metadata),
          createdAt: row.created_at,
          updatedAt: row.updated_at,
        });
        if (!parsed.success) continue;
        if (!nodeMatchesFilters(parsed.data, options.filters)) continue;
        nodes.push(parsed.data);
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
      const row = this.db.prepare(
        'SELECT subject, predicate, object, metadata, created_at FROM edges WHERE subject = ? AND predicate = ? AND object = ?'
      ).get(subject, predicate, object) as EdgeRow | undefined;
      const metadata = data.metadata ?? {};

      if (!row) {
        const edge: GraphEdge = {
          subject,
          predicate,
          object,
          metadata,
          createdAt: nowIso(),
        };
        const validated = GraphEdgeSchema.parse(edge);
        this.db.prepare(
          'INSERT INTO edges (subject, predicate, object, metadata, created_at) VALUES (?, ?, ?, ?, ?)'
        ).run(
          validated.subject,
          validated.predicate,
          validated.object,
          serializeMetadata(validated.metadata ?? {}),
          validated.createdAt
        );
        return { ok: true, value: { edge: validated, created: true, updated: false, noop: false } };
      }

      const existingEdge = GraphEdgeSchema.parse({
        subject: row.subject,
        predicate: row.predicate,
        object: row.object,
        metadata: parseMetadata(row.metadata),
        createdAt: row.created_at,
      });

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
      this.db.prepare(
        'UPDATE edges SET metadata = ? WHERE subject = ? AND predicate = ? AND object = ?'
      ).run(
        serializeMetadata(validated.metadata ?? {}),
        validated.subject,
        validated.predicate,
        validated.object
      );
      return { ok: true, value: { edge: validated, created: false, updated: true, noop: false } };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error : new Error(String(error)) };
    }
  }

  async getEdges(options: QueryEdgesOptions = {}): Promise<Result<QueryResult<GraphEdge>>> {
    try {
      const clauses: string[] = [];
      const params: unknown[] = [];
      if (options.subject) {
        clauses.push('subject = ?');
        params.push(options.subject);
      }
      if (options.predicate) {
        clauses.push('predicate = ?');
        params.push(options.predicate);
      }
      if (options.object) {
        clauses.push('object = ?');
        params.push(options.object);
      }
      const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
      const rows = this.db.prepare(
        `SELECT subject, predicate, object, metadata, created_at FROM edges ${where}`
      ).all(...params) as EdgeRow[];
      const edges: GraphEdge[] = [];
      for (const row of rows) {
        const parsed = GraphEdgeSchema.safeParse({
          subject: row.subject,
          predicate: row.predicate,
          object: row.object,
          metadata: parseMetadata(row.metadata),
          createdAt: row.created_at,
        });
        if (!parsed.success) continue;
        edges.push(parsed.data);
      }
      const sorted = sortEdges(edges, options.sort);
      const paged = applyCursorAndLimit(sorted, options.cursor, options.limit, edgeCursorKey);
      return { ok: true, value: paged };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error : new Error(String(error)) };
    }
  }

  async deleteNode(id: string, options?: DeleteNodeOptions): Promise<Result<void>> {
    try {
      if (this.ftsEnabled) {
        this.db.prepare('DELETE FROM nodes_fts WHERE id = ?').run(id);
      }
      this.db.prepare('DELETE FROM nodes WHERE id = ?').run(id);
      if (options?.cascade) {
        this.db.prepare('DELETE FROM edges WHERE subject = ? OR object = ?').run(id, id);
      }
      return { ok: true, value: undefined };
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

  async exportGephi(options: ExportGephiOptions = {}): Promise<Result<GephiExport>> {
    try {
      // Query edges with optional predicate filter
      let edgeSql = 'SELECT subject, predicate, object, created_at FROM edges';
      const edgeParams: unknown[] = [];
      if (options.predicates && options.predicates.length > 0) {
        edgeSql += ` WHERE predicate IN (${options.predicates.map(() => '?').join(', ')})`;
        edgeParams.push(...options.predicates);
      }
      edgeSql += ' ORDER BY subject, predicate, object';
      const edgeRows = this.db.prepare(edgeSql).all(...edgeParams) as Array<{
        subject: string; predicate: string; object: string; created_at: string;
      }>;

      const referencedIds = new Set<string>();
      for (const row of edgeRows) {
        referencedIds.add(row.subject);
        referencedIds.add(row.object);
      }

      // Query nodes with optional type filter
      let nodeSql = 'SELECT id, type, label, created_at FROM nodes';
      const nodeClauses: string[] = [];
      const nodeParams: unknown[] = [];
      if (options.nodeTypes && options.nodeTypes.length > 0) {
        nodeClauses.push(`type IN (${options.nodeTypes.map(() => '?').join(', ')})`);
        nodeParams.push(...options.nodeTypes);
      }
      if (nodeClauses.length > 0) {
        nodeSql += ` WHERE ${nodeClauses.join(' AND ')}`;
      }
      nodeSql += ' ORDER BY type, id';
      const nodeRows = this.db.prepare(nodeSql).all(...nodeParams) as Array<{
        id: string; type: string; label: string; created_at: string;
      }>;

      // Filter to referenced nodes if predicate filter is active
      let filteredNodeRows = nodeRows;
      if (options.predicates && options.predicates.length > 0) {
        filteredNodeRows = nodeRows.filter(n => referencedIds.has(n.id));
      }

      const gephiNodes: GephiNode[] = filteredNodeRows.map(n => ({
        id: n.id,
        ...(options.includeLabels ? { label: n.label } : {}),
        type: n.type,
        createdAt: n.created_at,
      }));

      // Filter edges to only those where both endpoints exist in the filtered node set
      const includedNodeIds = new Set(filteredNodeRows.map(n => n.id));
      const filteredEdges = edgeRows.filter(
        e => includedNodeIds.has(e.subject) && includedNodeIds.has(e.object),
      );

      const gephiEdges: GephiEdge[] = filteredEdges.map(e => ({
        source: e.subject,
        target: e.object,
        predicate: e.predicate,
        weight: 1,
        createdAt: e.created_at,
      }));

      return { ok: true, value: { nodes: gephiNodes, edges: gephiEdges } };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error : new Error(String(error)) };
    }
  }

  async getGraphStats(options: GetGraphStatsOptions = {}): Promise<Result<GraphStats>> {
    try {
      const topN = options.topN ?? 10;

      // Node counts by type
      const nodeCountRows = this.db.prepare(
        'SELECT type, COUNT(*) as count FROM nodes GROUP BY type ORDER BY type'
      ).all() as Array<{ type: string; count: number }>;
      const nodeCounts: Record<string, number> = {};
      for (const row of nodeCountRows) {
        nodeCounts[row.type] = row.count;
      }

      // Edge counts by predicate
      const edgeCountRows = this.db.prepare(
        'SELECT predicate, COUNT(*) as count FROM edges GROUP BY predicate ORDER BY predicate'
      ).all() as Array<{ predicate: string; count: number }>;
      const edgeCounts: Record<string, number> = {};
      for (const row of edgeCountRows) {
        edgeCounts[row.predicate] = row.count;
      }

      // Claim state counts from metadata
      const claimRows = this.db.prepare(
        "SELECT metadata FROM nodes WHERE type = 'Claim'"
      ).all() as Array<{ metadata: string | null }>;
      const claimStateCounts: Record<string, number> = {};
      for (const row of claimRows) {
        const meta = parseMetadata(row.metadata);
        const state = typeof meta['state'] === 'string' ? meta['state'] : 'unknown';
        claimStateCounts[state] = (claimStateCounts[state] ?? 0) + 1;
      }

      // Top-degree nodes: start from all edge endpoints (including dangling)
      // then LEFT JOIN to nodes for type lookup, using 'unknown' for missing nodes
      const degreeRows = this.db.prepare(`
        SELECT ep.id,
          COALESCE(n.type, 'unknown') AS type,
          COALESCE(i.in_deg, 0) AS in_degree,
          COALESCE(o.out_deg, 0) AS out_degree,
          COALESCE(i.in_deg, 0) + COALESCE(o.out_deg, 0) AS total_degree
        FROM (SELECT subject AS id FROM edges UNION SELECT object AS id FROM edges) AS ep
        LEFT JOIN nodes AS n ON ep.id = n.id
        LEFT JOIN (SELECT object AS nid, COUNT(*) AS in_deg FROM edges GROUP BY object) AS i ON ep.id = i.nid
        LEFT JOIN (SELECT subject AS nid, COUNT(*) AS out_deg FROM edges GROUP BY subject) AS o ON ep.id = o.nid
        ORDER BY total_degree DESC, ep.id ASC
        LIMIT ?
      `).all(topN) as Array<{
        id: string; type: string; in_degree: number; out_degree: number; total_degree: number;
      }>;

      const topDegreeNodes = degreeRows.map(row => ({
        id: row.id,
        type: row.type,
        inDegree: row.in_degree,
        outDegree: row.out_degree,
      }));

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
    this.db.close();
  }
}
