/**
 * Schema validation tests.
 */
import { describe, it, expect } from 'vitest';
import {
  GraphNode,
  CreateNodeInput,
  GraphEdge,
  CreateEdgeInput,
  Knowledge,
  NodeType,
  Predicate,
  SourceType,
} from '../src/schema/index.js';

describe('GraphNode schema', () => {
  const validNode = {
    id: 'node-1',
    type: 'Knowledge' as const,
    label: 'Test Node',
    content: 'Some content',
    metadata: { custom: 'value' },
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2025-01-01T00:00:00.000Z',
  };

  it('accepts valid node data', () => {
    const result = GraphNode.safeParse(validNode);
    expect(result.success).toBe(true);
  });

  it('rejects node without id', () => {
    const invalid = { ...validNode, id: '' };
    const result = GraphNode.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it('rejects node without label', () => {
    const invalid = { ...validNode, label: '' };
    const result = GraphNode.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it('rejects invalid node type', () => {
    const invalid = { ...validNode, type: 'InvalidType' };
    const result = GraphNode.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it('rejects invalid datetime format', () => {
    const invalid = { ...validNode, createdAt: 'not-a-date' };
    const result = GraphNode.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it('allows optional content', () => {
    const { content, ...withoutContent } = validNode;
    const result = GraphNode.safeParse(withoutContent);
    expect(result.success).toBe(true);
  });
});

describe('CreateNodeInput schema', () => {
  it('does not require timestamps', () => {
    const input = {
      id: 'node-1',
      type: 'Knowledge' as const,
      label: 'Test',
      metadata: {},
    };
    const result = CreateNodeInput.safeParse(input);
    expect(result.success).toBe(true);
  });
});

describe('GraphEdge schema', () => {
  const validEdge = {
    subject: 'node-1',
    predicate: 'relatedTo' as const,
    object: 'node-2',
    metadata: {},
    createdAt: '2025-01-01T00:00:00.000Z',
  };

  it('accepts valid edge data', () => {
    const result = GraphEdge.safeParse(validEdge);
    expect(result.success).toBe(true);
  });

  it('rejects invalid predicate', () => {
    const invalid = { ...validEdge, predicate: 'invalidPredicate' };
    const result = GraphEdge.safeParse(invalid);
    expect(result.success).toBe(false);
  });
});

describe('Knowledge schema', () => {
  const validKnowledge = {
    id: 'knowledge-1',
    type: 'Knowledge' as const,
    label: 'Test Knowledge',
    metadata: {
      provenance: {
        sourceType: 'youtube' as const,
        sourceUri: 'https://youtube.com/watch?v=abc',
        ingestedAt: '2025-01-01T00:00:00.000Z',
      },
      confidence: 0.85,
      tags: ['test', 'example'],
    },
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2025-01-01T00:00:00.000Z',
  };

  it('accepts valid knowledge with provenance', () => {
    const result = Knowledge.safeParse(validKnowledge);
    expect(result.success).toBe(true);
  });

  it('rejects confidence outside 0-1 range', () => {
    const invalid = {
      ...validKnowledge,
      metadata: { ...validKnowledge.metadata, confidence: 1.5 },
    };
    const result = Knowledge.safeParse(invalid);
    expect(result.success).toBe(false);
  });
});

describe('Enum schemas', () => {
  it('NodeType contains expected values', () => {
    expect(NodeType.options).toContain('Knowledge');
    expect(NodeType.options).toContain('Concept');
    expect(NodeType.options).toContain('Resource');
  });

  it('Predicate contains expected values', () => {
    expect(Predicate.options).toContain('relatedTo');
    expect(Predicate.options).toContain('partOf');
    expect(Predicate.options).toContain('derivedFrom');
  });

  it('SourceType contains expected values', () => {
    expect(SourceType.options).toContain('youtube');
    expect(SourceType.options).toContain('article');
    expect(SourceType.options).toContain('note');
  });
});
