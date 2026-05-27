/**
 * Public API smoke test.
 *
 * Verifies that the package's public root entrypoint correctly exports
 * expected symbols and types.
 */
import { describe, it, expect } from 'vitest';
import * as PublicApi from '../src/index.js';

describe('Public API', () => {
  it('exports core schema constants', () => {
    expect(PublicApi.CURRENT_GRAPH_SCHEMA_VERSION).toBeDefined();
    expect(PublicApi.CURRENT_JSONLD_EXPORT_SCHEMA_VERSION).toBeDefined();
  });

  it('exports schema validators', () => {
    expect(PublicApi.GraphNode).toBeDefined();
    expect(PublicApi.GraphEdge).toBeDefined();
    expect(PublicApi.Knowledge).toBeDefined();
    expect(PublicApi.CreateNodeInput).toBeDefined();
    expect(PublicApi.UpdateNodeInput).toBeDefined();
  });

  it('exports enum options', () => {
    expect(PublicApi.NodeType.options).toBeDefined();
    expect(PublicApi.Predicate.options).toBeDefined();
  });

  it('exports store implementations', () => {
    expect(PublicApi.InMemoryStore).toBeDefined();
    expect(PublicApi.SQLiteStore).toBeDefined();
    expect(PublicApi.LevelGraphStore).toBeDefined();
  });

  it('exports JSON-LD functionality', () => {
    expect(PublicApi.JSONLD_CONTEXT).toBeDefined();
    expect(PublicApi.toJsonLd).toBeTypeOf('function');
    expect(PublicApi.serializeJsonLd).toBeTypeOf('function');
  });

  it('exports types (type-only check)', () => {
    // This is primarily a compilation check for the test itself
    const node: PublicApi.GraphNode = {
      id: 'test',
      schemaVersion: PublicApi.CURRENT_GRAPH_SCHEMA_VERSION,
      type: 'Knowledge',
      label: 'Test',
      metadata: {},
      createdAt: '2025-01-01T00:00:00.000Z',
      updatedAt: '2025-01-01T00:00:00.000Z',
    };
    expect(node.id).toBe('test');
  });
});
