/**
 * In-memory TaxonomyRegistry implementation.
 *
 * Simple Map-based storage for MVP and testing.
 */
import type { TaxonomyRegistry, Result } from './types.js';
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
import {
  Category as CategorySchema,
  Topic as TopicSchema,
  Tag as TagSchema,
  TagAssignment as AssignmentSchema,
} from '../schema/index.js';

/**
 * Get current ISO timestamp.
 */
function now(): string {
  return new Date().toISOString();
}

/**
 * Assignment key for Map storage.
 */
function assignmentKey(nodeId: string, tagId: string): string {
  return `${nodeId}|${tagId}`;
}

/**
 * In-memory taxonomy registry for MVP and testing.
 */
export class InMemoryRegistry implements TaxonomyRegistry {
  private categories = new Map<string, Category>();
  private topics = new Map<string, Topic>();
  private tags = new Map<string, Tag>();
  private assignments = new Map<string, TagAssignment>();
  private aliasIndex = new Map<string, string>(); // alias -> tagId

  // Category operations
  async addCategory(input: CreateCategoryInput): Promise<Result<Category>> {
    try {
      const timestamp = now();
      const category: Category = {
        ...input,
        sortOrder: input.sortOrder ?? 0,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      const validated = CategorySchema.parse(category);
      this.categories.set(validated.id, validated);
      return { ok: true, value: validated };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error : new Error(String(error)) };
    }
  }

  async getCategory(id: string): Promise<Result<Category | null>> {
    return { ok: true, value: this.categories.get(id) ?? null };
  }

  async updateCategory(id: string, input: UpdateCategoryInput): Promise<Result<Category>> {
    try {
      const existing = this.categories.get(id);
      if (!existing) {
        return { ok: false, error: new Error(`Category not found: ${id}`) };
      }
      const updated: Category = {
        ...existing,
        ...input,
        id: existing.id,
        createdAt: existing.createdAt,
        updatedAt: now(),
      };
      const validated = CategorySchema.parse(updated);
      this.categories.set(id, validated);
      return { ok: true, value: validated };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error : new Error(String(error)) };
    }
  }

  async deleteCategory(id: string): Promise<Result<void>> {
    this.categories.delete(id);
    return { ok: true, value: undefined };
  }

  async listCategories(parentId?: string): Promise<Result<Category[]>> {
    let categories = Array.from(this.categories.values());
    if (parentId !== undefined) {
      categories = categories.filter(c => c.parentId === parentId);
    }
    return { ok: true, value: categories.sort((a, b) => a.sortOrder - b.sortOrder) };
  }

  // Topic operations
  async addTopic(input: CreateTopicInput): Promise<Result<Topic>> {
    try {
      const timestamp = now();
      const topic: Topic = {
        ...input,
        keywords: input.keywords ?? [],
        sortOrder: input.sortOrder ?? 0,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      const validated = TopicSchema.parse(topic);
      this.topics.set(validated.id, validated);
      return { ok: true, value: validated };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error : new Error(String(error)) };
    }
  }

  async getTopic(id: string): Promise<Result<Topic | null>> {
    return { ok: true, value: this.topics.get(id) ?? null };
  }

  async updateTopic(id: string, input: UpdateTopicInput): Promise<Result<Topic>> {
    try {
      const existing = this.topics.get(id);
      if (!existing) {
        return { ok: false, error: new Error(`Topic not found: ${id}`) };
      }
      const updated: Topic = {
        ...existing,
        ...input,
        id: existing.id,
        createdAt: existing.createdAt,
        updatedAt: now(),
      };
      const validated = TopicSchema.parse(updated);
      this.topics.set(id, validated);
      return { ok: true, value: validated };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error : new Error(String(error)) };
    }
  }

  async deleteTopic(id: string): Promise<Result<void>> {
    this.topics.delete(id);
    return { ok: true, value: undefined };
  }

  async listTopics(categoryId?: string): Promise<Result<Topic[]>> {
    let topics = Array.from(this.topics.values());
    if (categoryId !== undefined) {
      topics = topics.filter(t => t.categoryId === categoryId);
    }
    return { ok: true, value: topics.sort((a, b) => a.sortOrder - b.sortOrder) };
  }

  // Tag operations
  async addTag(input: CreateTagInput): Promise<Result<Tag>> {
    try {
      const timestamp = now();
      const tag: Tag = {
        ...input,
        aliases: input.aliases ?? [],
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      const validated = TagSchema.parse(tag);
      this.tags.set(validated.id, validated);

      // Index aliases
      this.aliasIndex.set(validated.name.toLowerCase(), validated.id);
      for (const alias of validated.aliases) {
        this.aliasIndex.set(alias.toLowerCase(), validated.id);
      }

      return { ok: true, value: validated };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error : new Error(String(error)) };
    }
  }

  async getTag(id: string): Promise<Result<Tag | null>> {
    return { ok: true, value: this.tags.get(id) ?? null };
  }

  async updateTag(id: string, input: UpdateTagInput): Promise<Result<Tag>> {
    try {
      const existing = this.tags.get(id);
      if (!existing) {
        return { ok: false, error: new Error(`Tag not found: ${id}`) };
      }

      // Remove old aliases from index
      this.aliasIndex.delete(existing.name.toLowerCase());
      for (const alias of existing.aliases) {
        this.aliasIndex.delete(alias.toLowerCase());
      }

      const updated: Tag = {
        ...existing,
        ...input,
        id: existing.id,
        createdAt: existing.createdAt,
        updatedAt: now(),
      };
      const validated = TagSchema.parse(updated);
      this.tags.set(id, validated);

      // Re-index aliases
      this.aliasIndex.set(validated.name.toLowerCase(), validated.id);
      for (const alias of validated.aliases) {
        this.aliasIndex.set(alias.toLowerCase(), validated.id);
      }

      return { ok: true, value: validated };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error : new Error(String(error)) };
    }
  }

  async deleteTag(id: string): Promise<Result<void>> {
    const tag = this.tags.get(id);
    if (tag) {
      this.aliasIndex.delete(tag.name.toLowerCase());
      for (const alias of tag.aliases) {
        this.aliasIndex.delete(alias.toLowerCase());
      }
    }
    this.tags.delete(id);
    return { ok: true, value: undefined };
  }

  async listTags(topicId?: string): Promise<Result<Tag[]>> {
    let tags = Array.from(this.tags.values());
    if (topicId !== undefined) {
      tags = tags.filter(t => t.topicIds.includes(topicId));
    }
    return { ok: true, value: tags.sort((a, b) => a.name.localeCompare(b.name)) };
  }

  async findTagByAlias(alias: string): Promise<Result<Tag | null>> {
    const tagId = this.aliasIndex.get(alias.toLowerCase());
    if (!tagId) {
      return { ok: true, value: null };
    }
    return { ok: true, value: this.tags.get(tagId) ?? null };
  }

  // Assignment operations
  async assignTag(input: CreateAssignmentInput): Promise<Result<TagAssignment>> {
    try {
      const assignment: TagAssignment = {
        ...input,
        confidence: input.confidence ?? 1,
        source: input.source ?? 'manual',
        assignedAt: now(),
      };
      const validated = AssignmentSchema.parse(assignment);
      const key = assignmentKey(validated.nodeId, validated.tagId);
      this.assignments.set(key, validated);
      return { ok: true, value: validated };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error : new Error(String(error)) };
    }
  }

  async getAssignments(nodeId: string): Promise<Result<TagAssignment[]>> {
    const assignments = Array.from(this.assignments.values())
      .filter(a => a.nodeId === nodeId);
    return { ok: true, value: assignments };
  }

  async removeAssignment(nodeId: string, tagId: string): Promise<Result<void>> {
    const key = assignmentKey(nodeId, tagId);
    this.assignments.delete(key);
    return { ok: true, value: undefined };
  }

  async close(): Promise<void> {
    this.categories.clear();
    this.topics.clear();
    this.tags.clear();
    this.assignments.clear();
    this.aliasIndex.clear();
  }

  // Utility methods for testing
  getCategoryCount(): number {
    return this.categories.size;
  }

  getTopicCount(): number {
    return this.topics.size;
  }

  getTagCount(): number {
    return this.tags.size;
  }
}
