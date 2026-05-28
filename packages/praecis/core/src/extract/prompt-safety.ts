/**
 * Prompt Safety Utilities
 *
 * Shared functions for sanitizing user input to prevent prompt injection attacks.
 * These utilities should be used wherever user-provided text is embedded into LLM prompts.
 */

/**
 * Escapes triple-quote delimiters in text to prevent prompt injection.
 * Replaces """ with ''' to avoid breaking the data fence.
 *
 * @param value - The text to escape
 * @returns Text with triple-quotes replaced
 *
 * @example
 * ```typescript
 * escapeTripleQuoted('My """cool""" video'); // => "My '''cool''' video"
 * ```
 */
export function escapeTripleQuoted(value: string): string {
  return value.replaceAll('"""', "'''");
}

/**
 * Sanitizes text for safe inclusion in LLM prompts.
 *
 * Protects against:
 * - Direct instruction override ("ignore all instructions")
 * - Command bypass attempts ("override constraints")
 * - Code fence injection (triple backticks)
 *
 * @param text - The text to sanitize
 * @param maxLength - Maximum length to return (prevents token flooding)
 * @returns Sanitized text safe for prompt inclusion
 *
 * @example
 * ```typescript
 * const safeLabel = sanitizeForPrompt(videoLabel, 200);
 * const safeText = sanitizeForPrompt(transcriptExcerpt, 1000);
 * ```
 */
export function sanitizeForPrompt(text: string, maxLength: number): string {
  const normalized = text.normalize('NFKC');
  const sanitized = normalized
    .replace(/ignore\s+(all\s+)?(instructions?|commands?|above|preceding)/gi, '[REDACTED]')
    .replace(/(override|bypass|disregard)\s+(instructions?|constraints?|rules?)/gi, '[REDACTED]')
    .replace(/\b(new\s+task|you\s+are\s+now|act\s+as|from\s+now\s+on)\b/gi, '[REDACTED]')
    .replace(/```/g, '\'\'\''); // Prevent code fence injection
  if (sanitized !== normalized) {
    console.warn('prompt safety: suspicious prompt content was redacted');
  }
  return Array.from(sanitized).slice(0, maxLength).join('');
}
