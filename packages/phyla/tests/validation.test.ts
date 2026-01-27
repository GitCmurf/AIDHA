/**
 * Validation tests.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { InMemoryRegistry } from '../src/registry/index.js';
import { validateTaxonomy } from '../src/validation/index.js';

describe('validateTaxonomy', () => {
  let registry: InMemoryRegistry;

  beforeEach(() => {
    registry = new InMemoryRegistry();
  });

  afterEach(async () => {
    await registry.close();
  });

  it('returns valid for empty taxonomy', async () => {
    const result = await validateTaxonomy(registry);
    expect(result.valid).toBe(true);
    expect(result.issues.length).toBe(0);
  });

  it('returns valid for consistent taxonomy', async () => {
    await registry.addCategory({ id: 'cat-1', name: 'Tech' });
    await registry.addTopic({ id: 'topic-1', name: 'TS', categoryId: 'cat-1' });
    await registry.addTag({ id: 'tag-1', name: 'react', topicIds: ['topic-1'] });

    const result = await validateTaxonomy(registry);
    expect(result.valid).toBe(true);
    expect(result.issues.length).toBe(0);
  });

  it('detects orphaned topic', async () => {
    // Topic references non-existent category
    await registry.addTopic({ id: 'topic-1', name: 'TS', categoryId: 'missing' });

    const result = await validateTaxonomy(registry);
    expect(result.valid).toBe(false);
    expect(result.summary.errors).toBe(1);
    expect(result.issues[0]?.code).toBe('ORPHANED_TOPIC');
  });

  it('detects orphaned tag', async () => {
    // Tag references non-existent topic
    await registry.addTag({ id: 'tag-1', name: 'react', topicIds: ['missing'] });

    const result = await validateTaxonomy(registry);
    expect(result.valid).toBe(false);
    expect(result.summary.errors).toBe(1);
    expect(result.issues[0]?.code).toBe('ORPHANED_TAG');
  });

  it('detects partial orphan (warning)', async () => {
    await registry.addCategory({ id: 'cat-1', name: 'Tech' });
    await registry.addTopic({ id: 'topic-1', name: 'TS', categoryId: 'cat-1' });
    // Tag has one valid and one invalid topic
    await registry.addTag({ id: 'tag-1', name: 'react', topicIds: ['topic-1', 'missing'] });

    const result = await validateTaxonomy(registry);
    expect(result.valid).toBe(true); // Warnings don't make it invalid
    expect(result.summary.warnings).toBe(1);
    expect(result.issues[0]?.code).toBe('PARTIAL_ORPHAN_TAG');
  });

  it('detects circular category reference', async () => {
    // Create circular: A -> B -> A
    await registry.addCategory({ id: 'cat-a', name: 'A', parentId: 'cat-b' });
    await registry.addCategory({ id: 'cat-b', name: 'B', parentId: 'cat-a' });

    const result = await validateTaxonomy(registry);
    expect(result.valid).toBe(false);
    expect(result.issues.some(i => i.code === 'CIRCULAR_CATEGORY')).toBe(true);
  });
});
