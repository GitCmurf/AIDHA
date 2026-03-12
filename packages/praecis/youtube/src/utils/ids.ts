import { createHash } from 'node:crypto';

const SAFE_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;
const MAX_ID_LENGTH = 100;

// Special filesystem marker values
const CURRENT_DIR_MARKER = '.';
const PARENT_DIR_MARKER = '..';

/**
 * Validates that an identifier is safe for use in file paths and API calls.
 * Checks for: string type, length limits, path traversal sequences, and valid characters.
 */
export function isValidSafeId(id: unknown): id is string {
  if (typeof id !== 'string') return false;
  if (id.length === 0 || id.length > MAX_ID_LENGTH) return false;
  if (id.includes('..')) return false;
  return SAFE_ID_PATTERN.test(id);
}

/**
 * Validates an identifier and returns it if valid, or null if invalid.
 * Empty string is rejected for consistency with isValidSafeId.
 */
export function validateSafeId(id: string): string | null {
  if (typeof id !== 'string') return null;
  if (id.length === 0) return null; // Reject empty, align with isValidSafeId
  if (id.length > MAX_ID_LENGTH) return null;
  if (id.includes('..')) return null;
  if (!SAFE_ID_PATTERN.test(id)) return null;
  return id;
}

/**
 * Sanitizes a string for safe use as a filename by replacing filesystem-unsafe characters.
 * Replaces Windows reserved characters and other unsafe characters with underscores.
 *
 * @param id - The identifier to sanitize
 * @returns A sanitized identifier safe for use in file paths
 *
 * @example
 * ```ts
 * sanitizeFilename("video:1"); // "video_1"
 * sanitizeFilename("a<b>c:d|e?f*g"); // "a_b_c_d_e_f_g"
 * ```
 */
export function sanitizeFilename(id: string): string {
  // Single pass: replace unsafe filesystem characters and control characters
  const result = id.replace(/[<>:"/\\|?*]|[\x00-\x1F]/g, "_");
  if (result === '' || result === CURRENT_DIR_MARKER || result === PARENT_DIR_MARKER) {
    return '_';
  }
  return result;
}

export function hashId(prefix: string, parts: Array<string | number | undefined>): string {
  const input = [prefix, ...parts.map(part => (part === undefined ? '' : String(part)))].join('|');
  const digest = createHash('sha256').update(input).digest('hex').slice(0, 16);
  return `${prefix}-${digest}`;
}
