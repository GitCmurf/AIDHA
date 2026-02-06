import type { IngestionStatus } from '../pipeline/status.js';

interface StatusFormatOptions {
  json?: boolean;
}

export function formatIngestionStatus(
  status: IngestionStatus,
  options: StatusFormatOptions = {}
): string {
  if (options.json) {
    return JSON.stringify(status, null, 2);
  }

  const lines: string[] = [
    `Status for ${status.resourceId}`,
    `Transcript: ${status.transcriptStatus}${status.transcriptLanguage ? ` (${status.transcriptLanguage})` : ''}`,
  ];

  if (status.transcriptError) {
    lines.push(`Transcript error: ${status.transcriptError}`);
  }

  lines.push(`Excerpts: ${status.excerptCount}`);
  lines.push(`Claims: ${status.claimCount}`);
  lines.push(`References: ${status.referenceCount}`);

  return lines.join('\n');
}
