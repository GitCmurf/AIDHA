// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 Colin Farmer (GitCmurf)

/**
 * @aidha/taxonomy
 *
 * Classification taxonomy for knowledge entities.
 */

// Schema exports
export {
  Category,
  CreateCategoryInput,
  UpdateCategoryInput,
  Topic,
  CreateTopicInput,
  UpdateTopicInput,
  Tag,
  CreateTagInput,
  UpdateTagInput,
  AssignmentSource,
  TagAssignment,
  CreateAssignmentInput,
} from './schema/index.js';

// Registry exports
export type { TaxonomyRegistry, Result } from './registry/index.js';
export { InMemoryRegistry } from './registry/index.js';

// Validation exports
export {
  type IssueSeverity,
  type ValidationIssue,
  type ValidationResult,
  validateTaxonomy,
} from './validation/index.js';
