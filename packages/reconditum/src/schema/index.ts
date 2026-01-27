/**
 * Schema module - re-exports all schema definitions.
 */
export {
  NodeType,
  NodeMetadata,
  GraphNode,
  CreateNodeInput,
  UpdateNodeInput,
} from './node.js';

export {
  Predicate,
  EdgeMetadata,
  GraphEdge,
  CreateEdgeInput,
  type LevelGraphTriple,
} from './edge.js';

export {
  SourceType,
  Provenance,
  KnowledgeMetadata,
  Knowledge,
  CreateKnowledgeInput,
} from './knowledge.js';
