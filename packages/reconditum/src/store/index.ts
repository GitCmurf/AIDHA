/**
 * Store module - exports store types and implementations.
 */
export type {
  GraphStore,
  Result,
  QueryNodesOptions,
  QueryEdgesOptions,
} from './types.js';

export { LevelGraphStore } from './levelgraph.js';
export { InMemoryStore } from './memory.js';
