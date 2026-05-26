// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 Colin Farmer (GitCmurf)

import type { ClassificationResult, Clock, RunReport } from '../interfaces/index.js';
import type { Result } from '@aidha/taxonomy';

export type BatchOutcome = 'completed' | 'completed_with_errors' | 'failed';

export interface BatchItemFailure<TItem> {
  readonly item: TItem;
  readonly message: string;
  readonly timestamp: string;
}

export interface BatchItemSuccess<TItem, TValue> {
  readonly item: TItem;
  readonly value: TValue;
}

export interface BatchRunInput<TItem, TValue> {
  readonly items: readonly TItem[];
  readonly clock: Clock;
  runItem(item: TItem): Promise<Result<TValue>>;
}

export interface BatchRunResult<TItem, TValue> {
  readonly outcome: BatchOutcome;
  readonly total: number;
  readonly completed: number;
  readonly failed: number;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly successes: readonly BatchItemSuccess<TItem, TValue>[];
  readonly failures: readonly BatchItemFailure<TItem>[];
  readonly classification: ClassificationResult;
  readonly metadataConflictCount: number;
  readonly warnings: readonly string[];
}

function aggregateClassification(values: readonly { readonly report?: RunReport; readonly classification?: ClassificationResult }[]): ClassificationResult {
  const classifications = values.map(value => value.report?.classification ?? value.classification);
  return {
    status: classifications.some(classification => classification?.status === 'completed') ? 'completed' : 'disabled',
    tagsMatched: classifications.reduce((sum, classification) => sum + (classification?.tagsMatched ?? 0), 0),
    tagsAssigned: classifications.reduce((sum, classification) => sum + (classification?.tagsAssigned ?? 0), 0),
    warnings: Array.from(new Set(classifications.flatMap(classification => classification?.warnings ?? []))),
  };
}

function aggregateMetadataConflictCount(values: readonly { readonly report?: RunReport; readonly metadataConflictCount?: number }[]): number {
  return values.reduce((sum, value) => sum + (value.report?.metadataConflictCount ?? value.metadataConflictCount ?? 0), 0);
}

function aggregateWarnings(values: readonly { readonly report?: RunReport; readonly warnings?: readonly string[] }[]): readonly string[] {
  return Array.from(new Set(values.flatMap(value => value.report?.warnings ?? value.warnings ?? [])));
}

function outcome(total: number, failed: number): BatchOutcome {
  if (total > 0 && failed === total) return 'failed';
  if (failed > 0) return 'completed_with_errors';
  return 'completed';
}

export async function runBatch<TItem, TValue extends { readonly report?: RunReport; readonly classification?: ClassificationResult; readonly metadataConflictCount?: number; readonly warnings?: readonly string[] }>(
  input: BatchRunInput<TItem, TValue>,
): Promise<BatchRunResult<TItem, TValue>> {
  const startedAt = input.clock.now().toISOString();
  const successes: BatchItemSuccess<TItem, TValue>[] = [];
  const failures: BatchItemFailure<TItem>[] = [];

  for (const item of input.items) {
    const result = await input.runItem(item);
    if (result.ok) {
      successes.push({ item, value: result.value });
    } else {
      failures.push({ item, message: result.error.message, timestamp: input.clock.now().toISOString() });
    }
  }

  const values = successes.map(success => success.value);
  return {
    outcome: outcome(input.items.length, failures.length),
    total: input.items.length,
    completed: successes.length,
    failed: failures.length,
    startedAt,
    completedAt: input.clock.now().toISOString(),
    successes,
    failures,
    classification: aggregateClassification(values),
    metadataConflictCount: aggregateMetadataConflictCount(values),
    warnings: aggregateWarnings(values),
  };
}
