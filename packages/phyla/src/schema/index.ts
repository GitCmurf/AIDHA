// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 Colin Farmer (GitCmurf)

/**
 * Schema module - re-exports all taxonomy schemas.
 */
export {
  Category,
  CreateCategoryInput,
  UpdateCategoryInput,
} from './category.js';

export {
  Topic,
  CreateTopicInput,
  UpdateTopicInput,
} from './topic.js';

export {
  Tag,
  CreateTagInput,
  UpdateTagInput,
} from './tag.js';

export {
  AssignmentSource,
  TagAssignment,
  CreateAssignmentInput,
} from './assignment.js';
