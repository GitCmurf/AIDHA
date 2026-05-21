// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 Colin Farmer (GitCmurf)

export function toNumber(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && !Number.isNaN(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value);
    return Number.isNaN(parsed) ? fallback : parsed;
  }
  return fallback;
}

export function getStringMetadata(metadata: Record<string, unknown> | undefined, key: string): string | undefined {
  return typeof metadata?.[key] === 'string' ? (metadata[key] as string) : undefined;
}

export function getNumberMetadata(metadata: Record<string, unknown> | undefined, key: string): number | undefined {
  return typeof metadata?.[key] === 'number' ? (metadata[key] as number) : undefined;
}

export function normalizeText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

export function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1)}…`;
}

export function uniqueSortedStrings<T extends string>(items: readonly T[]): T[] {
  return Array.from(new Set(items)).sort((a, b) => a < b ? -1 : a > b ? 1 : 0) as T[];
}
