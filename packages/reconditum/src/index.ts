/**
 * @aidha/graph-backend
 *
 * Personal cognition graph backend with JSON-LD export.
 */

// Schema exports
export {
  NodeType,
  NodeMetadata,
  GraphNode,
  CreateNodeInput,
  UpdateNodeInput,
  Predicate,
  EdgeMetadata,
  GraphEdge,
  CreateEdgeInput,
  SourceType,
  Provenance,
  KnowledgeMetadata,
  Knowledge,
  CreateKnowledgeInput,
  type LevelGraphTriple,
} from './schema/index.js';

// Store exports
export type {
  GraphStore,
  Result,
  QueryNodesOptions,
  QueryEdgesOptions,
} from './store/index.js';

export { LevelGraphStore, InMemoryStore } from './store/index.js';

// Export functionality
export {
  JSONLD_CONTEXT,
  type JsonLdNode,
  type JsonLdDocument,
  nodeToJsonLd,
  toJsonLd,
  serializeJsonLd,
} from './export/index.js';
