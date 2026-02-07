import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { InMemoryStore, SQLiteStore } from '../src/store/index.js';
import type { GraphStore, Result } from '../src/store/types.js';

type TransactionStore = GraphStore & {
  runInTransaction: <T>(work: () => Promise<Result<T>>) => Promise<Result<T>>;
};

type StoreFactory = () => TransactionStore;

function asTransactional(store: GraphStore): TransactionStore {
  const transactional = store as Partial<TransactionStore>;
  if (typeof transactional.runInTransaction !== 'function') {
    throw new Error('Store does not support transactions');
  }
  return transactional as TransactionStore;
}

function runTransactionContract(name: string, createStore: StoreFactory): void {
  describe(name, () => {
    let store: TransactionStore;

    beforeEach(() => {
      store = createStore();
    });

    afterEach(async () => {
      await store.close();
    });

    it('rolls back all writes when a transaction returns an error result', async () => {
      await store.upsertNode('Task', 'task-base', { label: 'Base task' });

      const result = await store.runInTransaction(async () => {
        const node = await store.upsertNode('Task', 'task-transient', { label: 'Transient task' });
        if (!node.ok) return node;
        const edge = await store.upsertEdge('task-base', 'taskDependsOn', 'task-transient', {});
        if (!edge.ok) return edge;
        return { ok: false, error: new Error('force rollback') };
      });

      expect(result.ok).toBe(false);

      const transientNode = await store.getNode('task-transient');
      expect(transientNode.ok).toBe(true);
      if (transientNode.ok) {
        expect(transientNode.value).toBeNull();
      }

      const edges = await store.getEdges({
        subject: 'task-base',
        predicate: 'taskDependsOn',
        object: 'task-transient',
      });
      expect(edges.ok).toBe(true);
      if (edges.ok) {
        expect(edges.value.items.length).toBe(0);
      }
    });

    it('rolls back all writes when a transaction throws', async () => {
      const result = await store.runInTransaction(async () => {
        const node = await store.upsertNode('Task', 'task-throw', { label: 'Throw task' });
        if (!node.ok) return node;
        throw new Error('boom');
      });

      expect(result.ok).toBe(false);

      const thrownNode = await store.getNode('task-throw');
      expect(thrownNode.ok).toBe(true);
      if (thrownNode.ok) {
        expect(thrownNode.value).toBeNull();
      }
    });

    it('rolls back outer transaction when nested transaction returns an error', async () => {
      const result = await store.runInTransaction(async () => {
        const outerNode = await store.upsertNode('Task', 'task-outer', { label: 'Outer task' });
        if (!outerNode.ok) return outerNode;

        return store.runInTransaction(async () => {
          const innerNode = await store.upsertNode('Task', 'task-inner', { label: 'Inner task' });
          if (!innerNode.ok) return innerNode;
          return { ok: false, error: new Error('nested failure') };
        });
      });

      expect(result.ok).toBe(false);

      const outer = await store.getNode('task-outer');
      expect(outer.ok).toBe(true);
      if (outer.ok) expect(outer.value).toBeNull();

      const inner = await store.getNode('task-inner');
      expect(inner.ok).toBe(true);
      if (inner.ok) expect(inner.value).toBeNull();
    });

    it('serializes concurrent top-level transactions', async () => {
      let activeTransactions = 0;
      let overlaps = 0;
      const order: string[] = [];

      async function run(name: string, delayMs: number): Promise<Result<void>> {
        return store.runInTransaction(async () => {
          if (activeTransactions > 0) overlaps += 1;
          activeTransactions += 1;
          order.push(`${name}:start`);
          await new Promise(resolve => setTimeout(resolve, delayMs));
          order.push(`${name}:end`);
          activeTransactions -= 1;
          const upsert = await store.upsertNode('Task', `task-${name}`, { label: `Task ${name}` });
          if (!upsert.ok) return upsert;
          return { ok: true, value: undefined };
        });
      }

      const [first, second] = await Promise.all([run('a', 40), run('b', 10)]);
      expect(first.ok).toBe(true);
      expect(second.ok).toBe(true);
      expect(overlaps).toBe(0);
      expect(order.join(',')).toMatch(/^(a:start,a:end,b:start,b:end|b:start,b:end,a:start,a:end)$/);
    });

    it('commits nested success writes together', async () => {
      const result = await store.runInTransaction(async () => {
        const outer = await store.upsertNode('Task', 'task-outer-success', { label: 'Outer success' });
        if (!outer.ok) return outer;

        const inner = await store.runInTransaction(async () => {
          const innerNode = await store.upsertNode('Task', 'task-inner-success', { label: 'Inner success' });
          if (!innerNode.ok) return innerNode;
          const edge = await store.upsertEdge('task-outer-success', 'taskDependsOn', 'task-inner-success', {});
          if (!edge.ok) return edge;
          return { ok: true, value: undefined };
        });
        if (!inner.ok) return inner;

        return { ok: true, value: undefined };
      });

      expect(result.ok).toBe(true);

      const outer = await store.getNode('task-outer-success');
      expect(outer.ok).toBe(true);
      if (outer.ok) expect(outer.value).not.toBeNull();

      const inner = await store.getNode('task-inner-success');
      expect(inner.ok).toBe(true);
      if (inner.ok) expect(inner.value).not.toBeNull();

      const edge = await store.getEdges({
        subject: 'task-outer-success',
        predicate: 'taskDependsOn',
        object: 'task-inner-success',
      });
      expect(edge.ok).toBe(true);
      if (edge.ok) {
        expect(edge.value.items.length).toBe(1);
      }
    });

    it('handles randomized concurrent transactions without partial writes', async () => {
      await store.upsertNode('Task', 'task-anchor', { label: 'Anchor task' });
      const runs = 24;

      const operations = Array.from({ length: runs }, (_, index) =>
        store.runInTransaction(async () => {
          const taskId = `task-random-${index}`;
          const create = await store.upsertNode('Task', taskId, { label: `Random ${index}` });
          if (!create.ok) return create;
          const edge = await store.upsertEdge('task-anchor', 'taskDependsOn', taskId, {});
          if (!edge.ok) return edge;

          if (index % 5 === 0) {
            throw new Error(`throw-${index}`);
          }
          if (index % 3 === 0) {
            return { ok: false, error: new Error(`rollback-${index}`) };
          }
          return { ok: true, value: taskId };
        })
      );

      const results = await Promise.all(operations);
      const expectedCommitted = new Set<string>();
      for (let index = 0; index < results.length; index += 1) {
        const result = results[index];
        const taskId = `task-random-${index}`;
        const shouldCommit = index % 5 !== 0 && index % 3 !== 0;
        expect(result?.ok).toBe(shouldCommit);
        if (shouldCommit) expectedCommitted.add(taskId);
      }

      const allNodes = await store.queryNodes({ type: 'Task' });
      expect(allNodes.ok).toBe(true);
      if (!allNodes.ok) return;

      const createdIds = new Set(allNodes.value.items.map(node => node.id));
      expect(createdIds.has('task-anchor')).toBe(true);
      for (let index = 0; index < runs; index += 1) {
        const taskId = `task-random-${index}`;
        expect(createdIds.has(taskId)).toBe(expectedCommitted.has(taskId));
      }

      const allEdges = await store.getEdges({ subject: 'task-anchor', predicate: 'taskDependsOn' });
      expect(allEdges.ok).toBe(true);
      if (!allEdges.ok) return;
      const edgeTargets = new Set(allEdges.value.items.map(edge => edge.object));
      expect(edgeTargets).toEqual(expectedCommitted);
    });
  });
}

runTransactionContract('InMemoryStore transactions', () => asTransactional(new InMemoryStore()));
runTransactionContract('SQLiteStore transactions', () => asTransactional(SQLiteStore.createInMemory()));
