import type { GraphStore } from '@aidha/graph-backend';
import type { Result } from '../pipeline/types.js';

/**
 * Interface for stores that support transactional operations.
 * Extends GraphStore with the ability to run work within a transaction.
 */
export interface TransactionalStore {
  runInTransaction<T>(work: () => Promise<Result<T>>): Promise<Result<T>>;
}

/**
 * Type guard to check if a store supports transactions.
 * @param store - The store instance to check
 * @returns true if the store has a runInTransaction method
 */
export function hasTransactions(store: GraphStore): store is GraphStore & TransactionalStore {
  return typeof (store as Partial<TransactionalStore>).runInTransaction === 'function';
}

/**
 * Runs work atomically if the store supports transactions, otherwise runs it directly.
 * @param store - The graph store instance
 * @param work - The async work to execute
 * @returns The result of the work
 */
export async function runAtomically<T>(
  store: GraphStore,
  work: () => Promise<Result<T>>
): Promise<Result<T>> {
  if (!hasTransactions(store)) {
    return work();
  }
  return store.runInTransaction(work);
}
