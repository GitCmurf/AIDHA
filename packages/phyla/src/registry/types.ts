/**
 * TaxonomyRegistry interface - abstraction for taxonomy storage.
 */
import type {
  Category,
  CreateCategoryInput,
  UpdateCategoryInput,
  Topic,
  CreateTopicInput,
  UpdateTopicInput,
  Tag,
  CreateTagInput,
  UpdateTagInput,
  TagAssignment,
  CreateAssignmentInput,
} from '../schema/index.js';

/**
 * Result wrapper for operations that may fail.
 */
export type Result<T, E = Error> =
  | { ok: true; value: T }
  | { ok: false; error: E };

/**
 * TaxonomyRegistry interface.
 */
export interface TaxonomyRegistry {
  // Category operations
  addCategory(input: CreateCategoryInput): Promise<Result<Category>>;
  getCategory(id: string): Promise<Result<Category | null>>;
  updateCategory(id: string, input: UpdateCategoryInput): Promise<Result<Category>>;
  deleteCategory(id: string): Promise<Result<void>>;
  listCategories(parentId?: string): Promise<Result<Category[]>>;

  // Topic operations
  addTopic(input: CreateTopicInput): Promise<Result<Topic>>;
  getTopic(id: string): Promise<Result<Topic | null>>;
  updateTopic(id: string, input: UpdateTopicInput): Promise<Result<Topic>>;
  deleteTopic(id: string): Promise<Result<void>>;
  listTopics(categoryId?: string): Promise<Result<Topic[]>>;

  // Tag operations
  addTag(input: CreateTagInput): Promise<Result<Tag>>;
  getTag(id: string): Promise<Result<Tag | null>>;
  updateTag(id: string, input: UpdateTagInput): Promise<Result<Tag>>;
  deleteTag(id: string): Promise<Result<void>>;
  listTags(topicId?: string): Promise<Result<Tag[]>>;
  findTagByAlias(alias: string): Promise<Result<Tag | null>>;

  // Assignment operations
  assignTag(input: CreateAssignmentInput): Promise<Result<TagAssignment>>;
  getAssignments(nodeId: string): Promise<Result<TagAssignment[]>>;
  removeAssignment(nodeId: string, tagId: string): Promise<Result<void>>;

  // Lifecycle
  close(): Promise<void>;
}
