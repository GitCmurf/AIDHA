// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 Colin Farmer (GitCmurf)

export const MAX_PARSE_ERRORS = 10;

export const capErrors = (errors: readonly string[]): readonly string[] => {
  if (errors.length <= MAX_PARSE_ERRORS) return errors;
  return [...errors.slice(0, MAX_PARSE_ERRORS), `(${errors.length - MAX_PARSE_ERRORS} more errors omitted)`];
};

/** Return the matching closing brace, ignoring braces inside JSON strings. */
const objectEnd = (text: string, start: number): number => {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
    } else if (char === '"') inString = true;
    else if (char === '{') depth += 1;
    else if (char === '}' && --depth === 0) return index + 1;
  }
  return -1;
};

/**
 * Extracts the first valid JSON object from an LLM response, tolerating
 * markdown fences and leading/trailing prose. Falls back to the raw tail
 * when a brace is opened but never closed so JSON.parse can report the
 * truncation precisely.
 */
export const extractJsonObject = (text: string): string | null => {
  const trimmed = text.trim();
  let candidate = trimmed;
  // A valid JSON string can itself contain backticks. Prefer the response when
  // it starts with an object; otherwise consider only complete JSON/plain fences.
  if (!trimmed.startsWith('{')) {
    for (const match of trimmed.matchAll(/^```([^\r\n`]*)\r?\n([\s\S]*?)^```[\t ]*$/gim)) {
      const language = match[1]?.trim().toLowerCase();
      if (language !== '' && language !== 'json') continue;
      const body = match[2]?.trim();
      if (body?.startsWith('{')) {
        candidate = body;
        break;
      }
    }
  }
  const first = candidate.indexOf('{');
  if (first === -1) return null; // no brace → "no JSON object" (existing behavior)
  let start = first;
  while (start !== -1) {
    const end = objectEnd(candidate, start);
    if (end === -1) break;
    const object = candidate.slice(start, end);
    try {
      JSON.parse(object);
      return object;
    } catch {
      // Balanced prose placeholders such as {excerptId} are not JSON objects.
      start = candidate.indexOf('{', end);
    }
  }
  // Preserve malformed/truncated input for the caller's readable JSON error.
  return candidate.slice(first);
};
