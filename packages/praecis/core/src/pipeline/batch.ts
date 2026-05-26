// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 Colin Farmer (GitCmurf)

import type { ClassificationResult, Clock, ReferenceExtractionReport, RunReport } from '../interfaces/index.js';
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
  readonly concurrency?: number;
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
  readonly references: ReferenceExtractionReport;
  readonly warnings: readonly string[];
}

function aggregateClassification(values: readonly { readonly report: RunReport }[]): ClassificationResult {
  const classifications = values.map(value => value.report.classification);
  return {
    status: classifications.some(classification => classification?.status === 'completed') ? 'completed' : 'disabled',
    tagsMatched: classifications.reduce((sum, classification) => sum + (classification?.tagsMatched ?? 0), 0),
    tagsAssigned: classifications.reduce((sum, classification) => sum + (classification?.tagsAssigned ?? 0), 0),
    warnings: Array.from(new Set(classifications.flatMap(classification => classification?.warnings ?? []))),
  };
}

function aggregateMetadataConflictCount(values: readonly { readonly report: RunReport }[]): number {
  return values.reduce((sum, value) => sum + value.report.metadataConflictCount, 0);
}

function aggregateReferences(values: readonly { readonly report: RunReport }[]): ReferenceExtractionReport {
  return {
    referencesCreated: values.reduce((sum, value) => sum + value.report.references.referencesCreated, 0),
    referencesUpdated: values.reduce((sum, value) => sum + value.report.references.referencesUpdated, 0),
    referencesNoop: values.reduce((sum, value) => sum + value.report.references.referencesNoop, 0),
    referenceEdgesCreated: values.reduce((sum, value) => sum + value.report.references.referenceEdgesCreated, 0),
    referenceEdgesUpdated: values.reduce((sum, value) => sum + value.report.references.referenceEdgesUpdated, 0),
    referenceEdgesNoop: values.reduce((sum, value) => sum + value.report.references.referenceEdgesNoop, 0),
  };
}

function aggregateWarnings(values: readonly { readonly report: RunReport }[]): readonly string[] {
  return Array.from(new Set(values.flatMap(value => value.report.warnings)));
}

function outcome(total: number, failed: number): BatchOutcome {
  if (total > 0 && failed === total) return 'failed';
  if (failed > 0) return 'completed_with_errors';
  return 'completed';
}

export async function runBatch<TItem, TValue extends { readonly report: RunReport }>(
  input: BatchRunInput<TItem, TValue>,
): Promise<BatchRunResult<TItem, TValue>> {
  const startedAt = input.clock.now().toISOString();
  const successes: BatchItemSuccess<TItem, TValue>[] = [];
  const failures: BatchItemFailure<TItem>[] = [];
  const concurrency = Math.max(1, Math.floor(input.concurrency ?? 1));

  async function runOne(item: TItem, index: number): Promise<{ readonly index: number; readonly item: TItem; readonly result: Result<TValue> }> {
    try {
      return { index, item, result: await input.runItem(item) };
    } catch (error) {
      return { index, item, result: { ok: false, error: error instanceof Error ? error : new Error(String(error)) } };
    }
  }

  const settled: Array<{ readonly index: number; readonly item: TItem; readonly result: Result<TValue> }> = [];
  for (let index = 0; index < input.items.length; index += concurrency) {
    const slice = input.items.slice(index, index + concurrency);
    settled.push(...await Promise.all(slice.map((item, offset) => runOne(item, index + offset))));
  }

  for (const { item, result } of settled.sort((a, b) => a.index - b.index)) {
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
    references: aggregateReferences(values),
    warnings: aggregateWarnings(values),
  };
}
