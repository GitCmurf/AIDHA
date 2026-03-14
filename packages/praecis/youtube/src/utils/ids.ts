import { createHash } from 'node:crypto';

const SAFE_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;
const MAX_ID_LENGTH = 100;
const WINDOWS_RESERVED_NAMES = new Set([
  'CON',
  'PRN',
  'AUX',
  'NUL',
  'COM1',
  'COM2',
  'COM3',
  'COM4',
  'COM5',
  'COM6',
  'COM7',
  'COM8',
  'COM9',
  'LPT1',
  'LPT2',
  'LPT3',
  'LPT4',
  'LPT5',
  'LPT6',
  'LPT7',
  'LPT8',
  'LPT9',
]);

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
export function validateSafeId(id: unknown): string | null {
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
  // Replace unsafe filesystem characters
  let result = id.replace(/[<>:"/\\|?*]/g, "_");
  // Replace control characters (0x00-0x1F)
  result = result.replace(/[\x00-\x1F]/g, "_");
  // Replace multiple dots
  result = result.replace(/\.+/g, ".");
  result = result.trim();
  // Check Windows reserved names (base name before first extension)
  const windowsBaseName = result.split(".", 1)[0]?.toUpperCase() ?? "";
  if (
    result === '' ||
    result === CURRENT_DIR_MARKER ||
    result === PARENT_DIR_MARKER ||
    WINDOWS_RESERVED_NAMES.has(windowsBaseName)
  ) {
    return '_';
  }
  return result;
}

export function hashId(prefix: string, parts: Array<string | number | undefined>): string {
  const input = [prefix, ...parts.map(part => (part === undefined ? '' : String(part)))].join('|');
  const digest = createHash('sha256').update(input).digest('hex').slice(0, 16);
  return `${prefix}-${digest}`;
}
