// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 Colin Farmer (GitCmurf)

/**
 * Schema module - re-exports all schema definitions.
 */
export {
  CURRENT_GRAPH_SCHEMA_VERSION,
  CURRENT_JSONLD_EXPORT_SCHEMA_VERSION,
} from './version.js';

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
