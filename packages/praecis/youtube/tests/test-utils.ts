/**
 * Shared test utilities for YouTube package tests.
 */

import { createRequire } from 'node:module';
import { describe } from 'vitest';

/**
 * Detects whether node:sqlite module is available.
 * Used to conditionally skip SQLite-dependent tests.
 */
export const hasNodeSqlite = (() => {
  try {
    createRequire(import.meta.url)('node:sqlite');
    return true;
  } catch {
    return false;
  }
})();

/**
 * Vitest describe function that runs only when node:sqlite is available.
 * Use this for tests that depend on SQLite functionality.
 */
export const describeIfSqlite = hasNodeSqlite ? describe : describe.skip;
