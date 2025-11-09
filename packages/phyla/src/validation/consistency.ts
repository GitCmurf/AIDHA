// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 Colin Farmer (GitCmurf)

/**
 * Taxonomy validation utilities.
 *
 * Checks for consistency issues like orphaned tags, missing parents.
 */
import type { TaxonomyRegistry } from '../registry/types.js';

/**
 * Validation issue severity.
 */
export type IssueSeverity = 'error' | 'warning' | 'info';

/**
 * A validation issue found in the taxonomy.
 */
export interface ValidationIssue {
  severity: IssueSeverity;
  code: string;
  message: string;
  entityType: 'category' | 'topic' | 'tag' | 'assignment';
  entityId: string;
}

/**
 * Validation result.
 */
export interface ValidationResult {
  valid: boolean;
  issues: ValidationIssue[];
  summary: {
    errors: number;
    warnings: number;
    info: number;
  };
}

/**
 * Check for orphaned topics (categoryId doesn't exist).
 */
async function checkOrphanedTopics(
  registry: TaxonomyRegistry
): Promise<ValidationIssue[]> {
  const issues: ValidationIssue[] = [];

  const topicsResult = await registry.listTopics();
  if (!topicsResult.ok) return issues;

  for (const topic of topicsResult.value) {
    const categoryResult = await registry.getCategory(topic.categoryId);
    if (!categoryResult.ok) continue;

    if (!categoryResult.value) {
      issues.push({
        severity: 'error',
        code: 'ORPHANED_TOPIC',
        message: `Topic "${topic.name}" references non-existent category "${topic.categoryId}"`,
        entityType: 'topic',
        entityId: topic.id,
      });
    }
  }

  return issues;
}

/**
 * Check for orphaned tags (no valid topicIds).
 */
async function checkOrphanedTags(
  registry: TaxonomyRegistry
): Promise<ValidationIssue[]> {
  const issues: ValidationIssue[] = [];

  const tagsResult = await registry.listTags();
  if (!tagsResult.ok) return issues;

  for (const tag of tagsResult.value) {
    let validTopics = 0;
    for (const topicId of tag.topicIds) {
      const topicResult = await registry.getTopic(topicId);
      if (topicResult.ok && topicResult.value) {
        validTopics++;
      }
    }

    if (validTopics === 0) {
      issues.push({
        severity: 'error',
        code: 'ORPHANED_TAG',
        message: `Tag "${tag.name}" has no valid topic references`,
        entityType: 'tag',
        entityId: tag.id,
      });
    } else if (validTopics < tag.topicIds.length) {
      issues.push({
        severity: 'warning',
        code: 'PARTIAL_ORPHAN_TAG',
        message: `Tag "${tag.name}" references ${tag.topicIds.length - validTopics} non-existent topics`,
        entityType: 'tag',
        entityId: tag.id,
      });
    }
  }

  return issues;
}

/**
 * Check for circular category references.
 */
async function checkCircularCategories(
  registry: TaxonomyRegistry
): Promise<ValidationIssue[]> {
  const issues: ValidationIssue[] = [];

  const categoriesResult = await registry.listCategories();
  if (!categoriesResult.ok) return issues;

  const categoryMap = new Map(categoriesResult.value.map(c => [c.id, c]));

  for (const category of categoriesResult.value) {
    if (!category.parentId) continue;

    const visited = new Set<string>();
    let current = category;

    while (current.parentId) {
      if (visited.has(current.id)) {
        issues.push({
          severity: 'error',
          code: 'CIRCULAR_CATEGORY',
          message: `Category "${category.name}" has circular parent reference`,
          entityType: 'category',
          entityId: category.id,
        });
        break;
      }
      visited.add(current.id);
      const parent = categoryMap.get(current.parentId);
      if (!parent) break;
      current = parent;
    }
  }

  return issues;
}

/**
 * Run all validation checks on a taxonomy registry.
 */
export async function validateTaxonomy(
  registry: TaxonomyRegistry
): Promise<ValidationResult> {
  const allIssues: ValidationIssue[] = [];

  // Run all checks
  allIssues.push(...await checkOrphanedTopics(registry));
  allIssues.push(...await checkOrphanedTags(registry));
  allIssues.push(...await checkCircularCategories(registry));

  // Summarize
  const summary = {
    errors: allIssues.filter(i => i.severity === 'error').length,
    warnings: allIssues.filter(i => i.severity === 'warning').length,
    info: allIssues.filter(i => i.severity === 'info').length,
  };

  return {
    valid: summary.errors === 0,
    issues: allIssues,
    summary,
  };
}
