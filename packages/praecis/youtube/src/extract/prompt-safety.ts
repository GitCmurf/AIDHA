/**
 * Prompt Safety Utilities
 *
 * Shared functions for sanitizing user input to prevent prompt injection attacks.
 * These utilities should be used wherever user-provided text is embedded into LLM prompts.
 */

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
  return text
    .replace(/ignore\s+(all\s+)?(instructions?|commands?|above|preceding)/gi, '[REDACTED]')
    .replace(/(override|bypass|disregard)\s+(instructions?|constraints?|rules?)/gi, '[REDACTED]')
    .replace(/```/g, '\'\'\'') // Prevent code fence injection
    .slice(0, maxLength); // Limit length
}
