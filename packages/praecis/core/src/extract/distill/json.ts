// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 Colin Farmer (GitCmurf)

export const MAX_PARSE_ERRORS = 10;

export function capErrors(errors: readonly string[]): readonly string[] {
  if (errors.length <= MAX_PARSE_ERRORS) return errors;
  return [...errors.slice(0, MAX_PARSE_ERRORS), `(${errors.length - MAX_PARSE_ERRORS} more errors omitted)`];
}

/**
 * Extracts the outermost JSON object from an LLM response, tolerating
 * markdown fences and leading/trailing prose. Falls back to the raw tail
 * when a brace is opened but never closed so JSON.parse can report the
 * truncation precisely.
 */
export function extractJsonObject(text: string): string | null {
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenceMatch && typeof fenceMatch[1] === 'string' ? fenceMatch[1] : text;
  const first = candidate.indexOf('{');
  if (first === -1) return null; // no brace → "no JSON object" (existing behavior)
  const last = candidate.lastIndexOf('}');
  if (last <= first) return candidate.slice(first); // truncated → JSON.parse fails → "not valid JSON"
  return candidate.slice(first, last + 1);
}
