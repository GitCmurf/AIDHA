/**
 * Shared utilities for judge prompt builders.
 */

export const MAX_TRANSCRIPT_PROMPT_CHARS = 50000;

export function sanitizePromptInput(text: string): string {
  return text
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, " ")
    .replace(/<TRANSCRIPT>/gi, "< TRANSCRIPT>")
    .replace(/<\/TRANSCRIPT>/gi, "< /TRANSCRIPT>")
    .replace(/<VIDEO_METADATA>/gi, "< VIDEO_METADATA>")
    .replace(/<\/VIDEO_METADATA>/gi, "< /VIDEO_METADATA>")
    .replace(/<CANDIDATE_CLAIMS>/gi, "< CANDIDATE_CLAIMS>")
    .replace(/<\/CANDIDATE_CLAIMS>/gi, "< /CANDIDATE_CLAIMS>")
    .replace(/<GOLD_CLAIMS>/gi, "< GOLD_CLAIMS>")
    .replace(/<\/GOLD_CLAIMS>/gi, "< /GOLD_CLAIMS>")
    .replace(/<TEACHER_CLAIMS>/gi, "< TEACHER_CLAIMS>")
    .replace(/<\/TEACHER_CLAIMS>/gi, "< /TEACHER_CLAIMS>");
}

export function truncateTranscript(text: string, maxChars: number = MAX_TRANSCRIPT_PROMPT_CHARS): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n[TRUNCATED ${text.length - maxChars} chars from transcript for judge context budget]`;
}

export function nk(s: string): string {
  return s.normalize("NFKC");
}
