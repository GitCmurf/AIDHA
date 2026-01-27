/**
 * JSON-LD export tests.
 */
import { describe, it, expect } from 'vitest';
import { toJsonLd, nodeToJsonLd, serializeJsonLd, JSONLD_CONTEXT } from '../src/export/index.js';
import type { GraphNode, GraphEdge } from '../src/schema/index.js';

describe('JSON-LD export', () => {
  const testNode: GraphNode = {
    id: 'node-1',
    type: 'Knowledge',
    label: 'Test Knowledge',
    content: 'This is test content',
    metadata: { custom: 'value' },
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2025-01-02T00:00:00.000Z',
  };

  describe('nodeToJsonLd', () => {
    it('converts node to JSON-LD format', () => {
      const result = nodeToJsonLd(testNode);

      expect(result['@id']).toBe('urn:aidha:node:node-1');
      expect(result['@type']).toBe('Knowledge');
      expect(result.label).toBe('Test Knowledge');
      expect(result.content).toBe('This is test content');
      expect(result.createdAt).toBe('2025-01-01T00:00:00.000Z');
    });

    it('spreads metadata into JSON-LD node', () => {
      const result = nodeToJsonLd(testNode);
      expect(result['custom']).toBe('value');
    });

    it('omits undefined content', () => {
      const nodeWithoutContent = { ...testNode, content: undefined };
      const result = nodeToJsonLd(nodeWithoutContent);
      expect('content' in result).toBe(false);
    });
  });

  describe('toJsonLd', () => {
    it('creates valid JSON-LD document', () => {
      const doc = toJsonLd([testNode]);

      expect(doc['@context']).toEqual(JSONLD_CONTEXT['@context']);
      expect(doc['@graph']).toHaveLength(1);
      expect(doc['@graph'][0]?.['@id']).toBe('urn:aidha:node:node-1');
    });

    it('includes multiple nodes in graph', () => {
      const nodes: GraphNode[] = [
        testNode,
        { ...testNode, id: 'node-2', label: 'Second Node' },
      ];

      const doc = toJsonLd(nodes);
      expect(doc['@graph']).toHaveLength(2);
    });

    it('applies edges as relationship properties', () => {
      const nodes: GraphNode[] = [
        testNode,
        { ...testNode, id: 'node-2', label: 'Related Node' },
      ];

      const edges: GraphEdge[] = [
        {
          subject: 'node-1',
          predicate: 'relatedTo',
          object: 'node-2',
          metadata: {},
          createdAt: '2025-01-01T00:00:00.000Z',
        },
      ];

      const doc = toJsonLd(nodes, edges);
      const node1 = doc['@graph'].find(n => n['@id'] === 'urn:aidha:node:node-1');

      expect(node1?.['relatedTo']).toBe('urn:aidha:node:node-2');
    });

    it('handles multiple edges to same relationship', () => {
      const nodes: GraphNode[] = [
        testNode,
        { ...testNode, id: 'node-2', label: 'Node 2' },
        { ...testNode, id: 'node-3', label: 'Node 3' },
      ];

      const edges: GraphEdge[] = [
        { subject: 'node-1', predicate: 'relatedTo', object: 'node-2', metadata: {}, createdAt: '2025-01-01T00:00:00.000Z' },
        { subject: 'node-1', predicate: 'relatedTo', object: 'node-3', metadata: {}, createdAt: '2025-01-01T00:00:00.000Z' },
      ];

      const doc = toJsonLd(nodes, edges);
      const node1 = doc['@graph'].find(n => n['@id'] === 'urn:aidha:node:node-1');

      expect(Array.isArray(node1?.['relatedTo'])).toBe(true);
      expect(node1?.['relatedTo']).toContain('urn:aidha:node:node-2');
      expect(node1?.['relatedTo']).toContain('urn:aidha:node:node-3');
    });
  });

  describe('serializeJsonLd', () => {
    it('serializes with pretty formatting by default', () => {
      const doc = toJsonLd([testNode]);
      const serialized = serializeJsonLd(doc);

      expect(serialized).toContain('\n');
      expect(serialized).toContain('  ');
    });

    it('serializes compact when pretty=false', () => {
      const doc = toJsonLd([testNode]);
      const serialized = serializeJsonLd(doc, false);

      // Compact JSON has no extra newlines
      expect(serialized.split('\n').length).toBe(1);
    });
  });

  describe('JSONLD_CONTEXT', () => {
    it('defines schema.org mappings', () => {
      const ctx = JSONLD_CONTEXT['@context'];

      expect(ctx['schema']).toBe('https://schema.org/');
      expect(ctx['label']).toBe('schema:name');
      expect(ctx['content']).toBe('schema:description');
    });

    it('defines relationship predicates as @id types', () => {
      const ctx = JSONLD_CONTEXT['@context'];

      expect(ctx['relatedTo']).toEqual({ '@type': '@id' });
      expect(ctx['partOf']).toEqual({ '@type': '@id' });
    });
  });
});
