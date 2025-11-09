// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 Colin Farmer (GitCmurf)

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
