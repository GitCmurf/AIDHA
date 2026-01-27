/**
 * Schema validation tests.
 */
import { describe, it, expect } from 'vitest';
import {
  Category,
  CreateCategoryInput,
  Topic,
  Tag,
  TagAssignment,
  AssignmentSource,
} from '../src/schema/index.js';

describe('Category schema', () => {
  const validCategory = {
    id: 'cat-1',
    name: 'Technology',
    description: 'Tech topics',
    sortOrder: 0,
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2025-01-01T00:00:00.000Z',
  };

  it('accepts valid category', () => {
    const result = Category.safeParse(validCategory);
    expect(result.success).toBe(true);
  });

  it('rejects category without name', () => {
    const invalid = { ...validCategory, name: '' };
    const result = Category.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it('allows optional parentId', () => {
    const withParent = { ...validCategory, parentId: 'parent-1' };
    const result = Category.safeParse(withParent);
    expect(result.success).toBe(true);
  });
});

describe('Topic schema', () => {
  const validTopic = {
    id: 'topic-1',
    name: 'TypeScript',
    categoryId: 'cat-1',
    keywords: ['ts', 'javascript'],
    sortOrder: 0,
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2025-01-01T00:00:00.000Z',
  };

  it('accepts valid topic', () => {
    const result = Topic.safeParse(validTopic);
    expect(result.success).toBe(true);
  });

  it('requires categoryId', () => {
    const invalid = { ...validTopic, categoryId: '' };
    const result = Topic.safeParse(invalid);
    expect(result.success).toBe(false);
  });
});

describe('Tag schema', () => {
  const validTag = {
    id: 'tag-1',
    name: 'react',
    topicIds: ['topic-1'],
    aliases: ['reactjs', 'react.js'],
    color: '#61DAFB',
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2025-01-01T00:00:00.000Z',
  };

  it('accepts valid tag', () => {
    const result = Tag.safeParse(validTag);
    expect(result.success).toBe(true);
  });

  it('requires at least one topicId', () => {
    const invalid = { ...validTag, topicIds: [] };
    const result = Tag.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it('validates hex color format', () => {
    const invalid = { ...validTag, color: 'red' };
    const result = Tag.safeParse(invalid);
    expect(result.success).toBe(false);
  });
});

describe('TagAssignment schema', () => {
  const validAssignment = {
    nodeId: 'node-1',
    tagId: 'tag-1',
    confidence: 0.9,
    source: 'automatic' as const,
    assignedAt: '2025-01-01T00:00:00.000Z',
  };

  it('accepts valid assignment', () => {
    const result = TagAssignment.safeParse(validAssignment);
    expect(result.success).toBe(true);
  });

  it('rejects confidence > 1', () => {
    const invalid = { ...validAssignment, confidence: 1.5 };
    const result = TagAssignment.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it('validates source enum', () => {
    expect(AssignmentSource.options).toContain('manual');
    expect(AssignmentSource.options).toContain('automatic');
    expect(AssignmentSource.options).toContain('imported');
  });
});
