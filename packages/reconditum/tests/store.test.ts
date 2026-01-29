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
      const createResult = await store.upsertNode(
        testNode.type,
        testNode.id,
        {
          label: testNode.label,
          content: testNode.content,
          metadata: testNode.metadata,
        },
        { detectNoop: true }
      );
      expect(createResult.ok).toBe(true);
      if (!createResult.ok) return;

      expect(createResult.value.node.id).toBe(testNode.id);
      expect(createResult.value.node.label).toBe(testNode.label);
      expect(createResult.value.node.createdAt).toBeDefined();

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
      await store.upsertNode(testNode.type, testNode.id, {
        label: testNode.label,
        content: testNode.content,
        metadata: testNode.metadata,
      });

      const updateResult = await store.upsertNode(
        testNode.type,
        testNode.id,
        {
          label: 'Updated Label',
          content: 'Updated content',
          metadata: testNode.metadata,
        },
        { detectNoop: true }
      );

      expect(updateResult.ok).toBe(true);
      if (!updateResult.ok) return;

      expect(updateResult.value.node.label).toBe('Updated Label');
      expect(updateResult.value.node.content).toBe('Updated content');
      expect(updateResult.value.node.id).toBe(testNode.id);
    });

    it('deletes a node', async () => {
      await store.upsertNode(testNode.type, testNode.id, {
        label: testNode.label,
        content: testNode.content,
        metadata: testNode.metadata,
      });

      const deleteResult = await store.deleteNode(testNode.id);
      expect(deleteResult.ok).toBe(true);

      const getResult = await store.getNode(testNode.id);
      expect(getResult.ok).toBe(true);
      if (!getResult.ok) return;
      expect(getResult.value).toBeNull();
    });

    it('queries nodes by type', async () => {
      await store.upsertNode('Knowledge', 'k1', { label: testNode.label, content: testNode.content, metadata: testNode.metadata });
      await store.upsertNode('Concept', 'c1', { label: 'Concept', content: testNode.content, metadata: testNode.metadata });
      await store.upsertNode('Knowledge', 'k2', { label: 'Knowledge 2', content: testNode.content, metadata: testNode.metadata });

      const result = await store.queryNodes({ type: 'Knowledge' });
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value.items.length).toBe(2);
      expect(result.value.items.every(n => n.type === 'Knowledge')).toBe(true);
    });

    it('applies pagination to query', async () => {
      for (let i = 0; i < 5; i++) {
        await store.upsertNode(testNode.type, `node-${i}`, { label: `Node ${i}`, content: testNode.content, metadata: testNode.metadata });
      }

      const result = await store.queryNodes({ limit: 2, cursor: '1' });
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value.items.length).toBe(2);
    });
  });

  describe('Edge operations', () => {
    const node1 = { id: 'n1', type: 'Knowledge' as const, label: 'Node 1' };
    const node2 = { id: 'n2', type: 'Knowledge' as const, label: 'Node 2' };

    beforeEach(async () => {
      await store.upsertNode(node1.type, node1.id, { label: node1.label });
      await store.upsertNode(node2.type, node2.id, { label: node2.label });
    });

    it('creates and retrieves an edge', async () => {
      const edge = {
        subject: 'n1',
        predicate: 'relatedTo' as const,
        object: 'n2',
        metadata: { weight: 0.8 },
      };

      const createResult = await store.upsertEdge(edge.subject, edge.predicate, edge.object, { metadata: edge.metadata }, { detectNoop: true });
      expect(createResult.ok).toBe(true);
      if (!createResult.ok) return;

      expect(createResult.value.edge.subject).toBe('n1');
      expect(createResult.value.edge.predicate).toBe('relatedTo');
      expect(createResult.value.edge.createdAt).toBeDefined();

      const getResult = await store.getEdges({ subject: 'n1' });
      expect(getResult.ok).toBe(true);
      if (!getResult.ok) return;

      expect(getResult.value.items.length).toBe(1);
      expect(getResult.value.items[0]?.object).toBe('n2');
    });

    it('queries edges by predicate', async () => {
      await store.upsertEdge('n1', 'relatedTo', 'n2', {});
      await store.upsertEdge('n1', 'partOf', 'n2', {});

      const result = await store.getEdges({ predicate: 'relatedTo' });
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value.items.length).toBe(1);
      expect(result.value.items[0]?.predicate).toBe('relatedTo');
    });
  });
});
