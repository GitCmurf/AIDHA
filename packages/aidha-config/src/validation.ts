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
 * @param maxLength - Maximum allowed length
 * @param context - Description of what is being validated (used in error message)
 * @throws {Error} If input exceeds maximum length
 *
 * @example
 * ```ts
 * validateLength(url, 2048, 'Base URL');
 * // Throws: "Base URL length (2050) exceeds maximum of 2048."
 * ```
 */
export function validateLength(value: string, maxLength: number, context: string): void {
  if (value.length > maxLength) {
    throw new Error(`${context} length (${value.length}) exceeds maximum of ${maxLength}.`);
  }
}
