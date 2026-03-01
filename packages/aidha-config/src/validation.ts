// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 Colin Farmer (GitCmurf)

/**
 * @aidha/config — Input validation utilities.
 *
 * Provides reusable validation functions for security and correctness.
 *
 * @module
 */

/**
 * Validates input length to prevent potential ReDoS attacks on regex operations.
 * Throws an error if the input exceeds the maximum allowed length.
 *
 * @param value - The value to validate
 * @param maxLength - Maximum allowed length (must be non-negative)
 * @param context - Description of what is being validated (used in error message)
 * @throws {Error} If input exceeds maximum length or maxLength is invalid
 *
 * @example
 * ```ts
 * validateLength(url, 2048, 'Base URL');
 * // Throws: "Base URL length (2050) exceeds maximum of 2048."
 * ```
 */
export function validateLength(value: string, maxLength: number, context: string): void {
  if (!Number.isFinite(maxLength) || !Number.isInteger(maxLength) || maxLength < 0) {
    throw new Error(
      `Invalid maxLength for ${context}: ${maxLength} (must be a non-negative integer)`,
    );
  }
  if (value.length > maxLength) {
    throw new Error(`${context} length (${value.length}) exceeds maximum of ${maxLength}.`);
  }
}
