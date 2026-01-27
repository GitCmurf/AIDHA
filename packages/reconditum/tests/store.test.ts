/**
 * In-memory store tests.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { InMemoryStore } from '../src/store/index.js';

describe('InMemoryStore', () => {
  let store: InMemoryStore;

  beforeEach(() => {
    store = new InMemoryStore();
  });

  afterEach(async () => {
    await store.close();
  });



  describe('Node operations', () => {
    const testNode = {
      id: 'test-node-1',
      type: 'Knowledge' as const,
      label: 'Test Node',
      content: 'Test content',
      metadata: { custom: 'value' },
    };

    it('creates and retrieves a node', async () => {
      const createResult = await store.createNode(testNode);
      expect(createResult.ok).toBe(true);
      if (!createResult.ok) return;

      expect(createResult.value.id).toBe(testNode.id);
      expect(createResult.value.label).toBe(testNode.label);
      expect(createResult.value.createdAt).toBeDefined();

      const getResult = await store.getNode(testNode.id);
      expect(getResult.ok).toBe(true);
      if (!getResult.ok) return;

      expect(getResult.value?.id).toBe(testNode.id);
      expect(getResult.value?.label).toBe(testNode.label);
    });

    it('returns null for non-existent node', async () => {
      const result = await store.getNode('non-existent');
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toBeNull();
    });

    it('updates a node', async () => {
      await store.createNode(testNode);

      const updateResult = await store.updateNode(testNode.id, {
        label: 'Updated Label',
        content: 'Updated content',
      });

      expect(updateResult.ok).toBe(true);
      if (!updateResult.ok) return;

      expect(updateResult.value.label).toBe('Updated Label');
      expect(updateResult.value.content).toBe('Updated content');
      expect(updateResult.value.id).toBe(testNode.id); // ID preserved
    });

    it('deletes a node', async () => {
      await store.createNode(testNode);

      const deleteResult = await store.deleteNode(testNode.id);
      expect(deleteResult.ok).toBe(true);

      const getResult = await store.getNode(testNode.id);
      expect(getResult.ok).toBe(true);
      if (!getResult.ok) return;
      expect(getResult.value).toBeNull();
    });

    it('queries nodes by type', async () => {
      await store.createNode({ ...testNode, id: 'k1', type: 'Knowledge' });
      await store.createNode({ ...testNode, id: 'c1', type: 'Concept', label: 'Concept' });
      await store.createNode({ ...testNode, id: 'k2', type: 'Knowledge', label: 'Knowledge 2' });

      const result = await store.queryNodes({ type: 'Knowledge' });
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value.length).toBe(2);
      expect(result.value.every(n => n.type === 'Knowledge')).toBe(true);
    });

    it('applies pagination to query', async () => {
      for (let i = 0; i < 5; i++) {
        await store.createNode({ ...testNode, id: `node-${i}`, label: `Node ${i}` });
      }

      const result = await store.queryNodes({ limit: 2, offset: 1 });
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value.length).toBe(2);
    });
  });

  describe('Edge operations', () => {
    const node1 = { id: 'n1', type: 'Knowledge' as const, label: 'Node 1' };
    const node2 = { id: 'n2', type: 'Knowledge' as const, label: 'Node 2' };

    beforeEach(async () => {
      await store.createNode(node1);
      await store.createNode(node2);
    });

    it('creates and retrieves an edge', async () => {
      const edge = {
        subject: 'n1',
        predicate: 'relatedTo' as const,
        object: 'n2',
        metadata: { weight: 0.8 },
      };

      const createResult = await store.createEdge(edge);
      expect(createResult.ok).toBe(true);
      if (!createResult.ok) return;

      expect(createResult.value.subject).toBe('n1');
      expect(createResult.value.predicate).toBe('relatedTo');
      expect(createResult.value.createdAt).toBeDefined();

      const getResult = await store.getEdges({ subject: 'n1' });
      expect(getResult.ok).toBe(true);
      if (!getResult.ok) return;

      expect(getResult.value.length).toBe(1);
      expect(getResult.value[0]?.object).toBe('n2');
    });

    it('queries edges by predicate', async () => {
      await store.createEdge({ subject: 'n1', predicate: 'relatedTo', object: 'n2' });
      await store.createEdge({ subject: 'n1', predicate: 'partOf', object: 'n2' });

      const result = await store.getEdges({ predicate: 'relatedTo' });
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value.length).toBe(1);
      expect(result.value[0]?.predicate).toBe('relatedTo');
    });

    it('deletes an edge', async () => {
      await store.createEdge({ subject: 'n1', predicate: 'relatedTo', object: 'n2' });

      const deleteResult = await store.deleteEdge('n1', 'relatedTo', 'n2');
      expect(deleteResult.ok).toBe(true);

      const getResult = await store.getEdges({ subject: 'n1', predicate: 'relatedTo' });
      expect(getResult.ok).toBe(true);
      if (!getResult.ok) return;
      expect(getResult.value.length).toBe(0);
    });
  });
});
