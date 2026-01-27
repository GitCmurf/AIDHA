/**
 * InMemoryRegistry tests.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { InMemoryRegistry } from '../src/registry/index.js';

describe('InMemoryRegistry', () => {
  let registry: InMemoryRegistry;

  beforeEach(() => {
    registry = new InMemoryRegistry();
  });

  afterEach(async () => {
    await registry.close();
  });

  describe('Category operations', () => {
    const testCategory = {
      id: 'cat-1',
      name: 'Technology',
      description: 'Tech topics',
    };

    it('creates and retrieves a category', async () => {
      const createResult = await registry.addCategory(testCategory);
      expect(createResult.ok).toBe(true);
      if (!createResult.ok) return;

      expect(createResult.value.name).toBe('Technology');

      const getResult = await registry.getCategory('cat-1');
      expect(getResult.ok).toBe(true);
      if (!getResult.ok) return;
      expect(getResult.value?.name).toBe('Technology');
    });

    it('updates a category', async () => {
      await registry.addCategory(testCategory);
      const updateResult = await registry.updateCategory('cat-1', { name: 'Tech' });
      expect(updateResult.ok).toBe(true);
      if (!updateResult.ok) return;
      expect(updateResult.value.name).toBe('Tech');
    });

    it('lists categories by parentId', async () => {
      await registry.addCategory({ id: 'parent', name: 'Parent' });
      await registry.addCategory({ id: 'child-1', name: 'Child 1', parentId: 'parent' });
      await registry.addCategory({ id: 'child-2', name: 'Child 2', parentId: 'parent' });
      await registry.addCategory({ id: 'other', name: 'Other' });

      const result = await registry.listCategories('parent');
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.length).toBe(2);
    });
  });

  describe('Topic operations', () => {
    beforeEach(async () => {
      await registry.addCategory({ id: 'cat-1', name: 'Technology' });
    });

    it('creates and retrieves a topic', async () => {
      const createResult = await registry.addTopic({
        id: 'topic-1',
        name: 'TypeScript',
        categoryId: 'cat-1',
      });
      expect(createResult.ok).toBe(true);

      const getResult = await registry.getTopic('topic-1');
      expect(getResult.ok).toBe(true);
      if (!getResult.ok) return;
      expect(getResult.value?.name).toBe('TypeScript');
    });

    it('lists topics by categoryId', async () => {
      await registry.addTopic({ id: 't1', name: 'TypeScript', categoryId: 'cat-1' });
      await registry.addTopic({ id: 't2', name: 'JavaScript', categoryId: 'cat-1' });

      const result = await registry.listTopics('cat-1');
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.length).toBe(2);
    });
  });

  describe('Tag operations', () => {
    beforeEach(async () => {
      await registry.addCategory({ id: 'cat-1', name: 'Technology' });
      await registry.addTopic({ id: 'topic-1', name: 'TypeScript', categoryId: 'cat-1' });
    });

    it('creates and retrieves a tag', async () => {
      const createResult = await registry.addTag({
        id: 'tag-1',
        name: 'react',
        topicIds: ['topic-1'],
        aliases: ['reactjs'],
      });
      expect(createResult.ok).toBe(true);

      const getResult = await registry.getTag('tag-1');
      expect(getResult.ok).toBe(true);
      if (!getResult.ok) return;
      expect(getResult.value?.name).toBe('react');
    });

    it('finds tag by alias', async () => {
      await registry.addTag({
        id: 'tag-1',
        name: 'react',
        topicIds: ['topic-1'],
        aliases: ['reactjs', 'react.js'],
      });

      const result = await registry.findTagByAlias('ReactJS');
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value?.id).toBe('tag-1');
    });

    it('lists tags by topicId', async () => {
      await registry.addTag({ id: 't1', name: 'react', topicIds: ['topic-1'] });
      await registry.addTag({ id: 't2', name: 'vue', topicIds: ['topic-1'] });

      const result = await registry.listTags('topic-1');
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.length).toBe(2);
    });
  });

  describe('Assignment operations', () => {
    beforeEach(async () => {
      await registry.addCategory({ id: 'cat-1', name: 'Tech' });
      await registry.addTopic({ id: 'topic-1', name: 'TS', categoryId: 'cat-1' });
      await registry.addTag({ id: 'tag-1', name: 'react', topicIds: ['topic-1'] });
    });

    it('assigns and retrieves tags', async () => {
      const assignResult = await registry.assignTag({
        nodeId: 'node-1',
        tagId: 'tag-1',
        confidence: 0.95,
        source: 'automatic',
      });
      expect(assignResult.ok).toBe(true);

      const getResult = await registry.getAssignments('node-1');
      expect(getResult.ok).toBe(true);
      if (!getResult.ok) return;
      expect(getResult.value.length).toBe(1);
      expect(getResult.value[0]?.confidence).toBe(0.95);
    });

    it('removes assignment', async () => {
      await registry.assignTag({ nodeId: 'node-1', tagId: 'tag-1' });
      await registry.removeAssignment('node-1', 'tag-1');

      const result = await registry.getAssignments('node-1');
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.length).toBe(0);
    });
  });
});
