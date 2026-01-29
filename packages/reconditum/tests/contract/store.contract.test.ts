import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { InMemoryStore, SQLiteStore } from '../../src/store/index.js';
import type { GraphStore } from '../../src/store/types.js';

type StoreFactory = () => GraphStore;

function runGraphStoreContract(name: string, createStore: StoreFactory): void {
  describe(name, () => {
    let store: GraphStore;

    beforeEach(() => {
      store = createStore();
    });

    afterEach(async () => {
      await store.close();
    });

    it('upserts nodes with noop detection', async () => {
      const data = { label: 'Resource 1', content: 'Content', metadata: { source: 'test' } };
      const first = await store.upsertNode('Resource', 'node-1', data, { detectNoop: true });
      expect(first.ok).toBe(true);
      if (!first.ok) return;
      expect(first.value.created).toBe(true);

      const second = await store.upsertNode('Resource', 'node-1', data, { detectNoop: true });
      expect(second.ok).toBe(true);
      if (!second.ok) return;
      expect(second.value.noop).toBe(true);
      expect(second.value.node.updatedAt).toBe(first.value.node.updatedAt);
    });

    it('orders query results deterministically and supports cursors', async () => {
      await store.upsertNode('Task', 'task-2', { label: 'Task 2' });
      await store.upsertNode('Area', 'area-1', { label: 'Area 1' });
      await store.upsertNode('Task', 'task-1', { label: 'Task 1' });

      const all = await store.queryNodes();
      expect(all.ok).toBe(true);
      if (!all.ok) return;
      const ids = all.value.items.map(node => `${node.type}:${node.id}`);
      expect(ids).toEqual(['Area:area-1', 'Task:task-1', 'Task:task-2']);

      const page1 = await store.queryNodes({ limit: 1 });
      expect(page1.ok).toBe(true);
      if (!page1.ok) return;
      const page2 = await store.queryNodes({ limit: 1, cursor: page1.value.nextCursor });
      expect(page2.ok).toBe(true);
      if (!page2.ok) return;
      expect(page2.value.items[0]?.id).toBe('task-1');
    });

    it('filters by metadata fields', async () => {
      await store.upsertNode('Resource', 'node-1', { label: 'Video', metadata: { videoId: 'v1' } });
      await store.upsertNode('Resource', 'node-2', { label: 'Other', metadata: { videoId: 'v2' } });

      const result = await store.queryNodes({ filters: { videoId: 'v1' } });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.items).toHaveLength(1);
      expect(result.value.items[0]?.id).toBe('node-1');
    });

    it('upserts edges with uniqueness and metadata updates', async () => {
      await store.upsertNode('Task', 't1', { label: 'Task 1' });
      await store.upsertNode('Task', 't2', { label: 'Task 2' });

      const first = await store.upsertEdge('t1', 'taskDependsOn', 't2', { metadata: { weight: 1 } }, { detectNoop: true });
      expect(first.ok).toBe(true);
      if (!first.ok) return;
      expect(first.value.created).toBe(true);

      const second = await store.upsertEdge('t1', 'taskDependsOn', 't2', { metadata: { weight: 1 } }, { detectNoop: true });
      expect(second.ok).toBe(true);
      if (!second.ok) return;
      expect(second.value.noop).toBe(true);

      const third = await store.upsertEdge('t1', 'taskDependsOn', 't2', { metadata: { weight: 2 } }, { detectNoop: true });
      expect(third.ok).toBe(true);
      if (!third.ok) return;
      expect(third.value.updated).toBe(true);
    });

    it('orders edges deterministically', async () => {
      await store.upsertNode('Task', 't1', { label: 'Task 1' });
      await store.upsertNode('Task', 't2', { label: 'Task 2' });
      await store.upsertEdge('t2', 'relatedTo', 't1', {});
      await store.upsertEdge('t1', 'partOf', 't2', {});
      await store.upsertEdge('t1', 'relatedTo', 't2', {});

      const edges = await store.getEdges({});
      expect(edges.ok).toBe(true);
      if (!edges.ok) return;
      const order = edges.value.items.map(edge => `${edge.subject}|${edge.predicate}|${edge.object}`);
      expect(order).toEqual([
        't1|partOf|t2',
        't1|relatedTo|t2',
        't2|relatedTo|t1',
      ]);
    });

    it('deletes nodes with cascade', async () => {
      await store.upsertNode('Task', 't1', { label: 'Task 1' });
      await store.upsertNode('Task', 't2', { label: 'Task 2' });
      await store.upsertEdge('t1', 'taskDependsOn', 't2', {});

      const deleteResult = await store.deleteNode('t2', { cascade: true });
      expect(deleteResult.ok).toBe(true);

      const edges = await store.getEdges({});
      expect(edges.ok).toBe(true);
      if (!edges.ok) return;
      expect(edges.value.items).toHaveLength(0);
    });

    it('exports knowledge-only snapshots', async () => {
      await store.upsertNode('Project', 'proj-1', { label: 'Operational', metadata: { scope: 'operational' } });
      await store.upsertNode('Task', 'task-1', { label: 'Task 1' });
      await store.upsertEdge('task-1', 'taskPartOfProject', 'proj-1', {});

      const snapshot = await store.exportSnapshot({ scope: 'knowledge' });
      expect(snapshot.ok).toBe(true);
      if (!snapshot.ok) return;
      const ids = snapshot.value.nodes.map(node => node.id);
      expect(ids).not.toContain('proj-1');
      expect(snapshot.value.edges).toHaveLength(0);
    });
  });
}

runGraphStoreContract('InMemoryStore', () => new InMemoryStore());
runGraphStoreContract('SQLiteStore', () => SQLiteStore.createInMemory());
