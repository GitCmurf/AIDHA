export type TranscriptSegment = { start: number; duration: number; text: string };
type TranscriptJsonSegment = { utf8?: string };
type TranscriptJsonEvent = {
  tStartMs?: number;
  dDurationMs?: number;
  segs?: TranscriptJsonSegment[];
};
type TranscriptJson = { events?: TranscriptJsonEvent[] };

export function decodeXmlEntities(value: string): string {
  // Use a single-pass approach to avoid ReDoS and prevent double escaping.
  // Note: &amp; must be replaced LAST to avoid double-decoding issues.
  // For example: &amp;quot; should become &quot; not "
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

export function parseTranscriptXml(xml: string): TranscriptSegment[] {
  const segments: TranscriptSegment[] = [];
  const textMatches = xml.matchAll(/<text start="([^"]+)" dur="([^"]+)"[^>]*>([\s\S]*?)<\/text>/g);

  for (const match of textMatches) {
    const start = parseFloat(match[1] ?? '0');
    const duration = parseFloat(match[2] ?? '0');
    const text = decodeXmlEntities(match[3] ?? '')
      .replace(/<[^>]+>/g, '')
      .replace(/\s+/g, ' ')
      .trim();

    if (text) {
      segments.push({ start, duration, text });
    }
  }

  return segments;
}

export function parseTranscriptJson(payload: string): TranscriptSegment[] {
  const sanitized = payload.trim().replace(/^\)\]\}'\s*/, '');
  let data: TranscriptJson | undefined;

  try {
    data = JSON.parse(sanitized) as TranscriptJson;
  } catch {
    return [];
  }

  const events = Array.isArray(data?.events) ? data.events : [];
  const segments: TranscriptSegment[] = [];

  for (const event of events) {
    const segs = Array.isArray(event?.segs) ? event?.segs : null;
    if (!segs) continue;
    const text = segs.map((segment: TranscriptJsonSegment) => segment?.utf8 ?? '').join('');
    if (!text.trim()) continue;
    const start = typeof event?.tStartMs === 'number' ? event.tStartMs / 1000 : 0;
    const duration = typeof event?.dDurationMs === 'number' ? event.dDurationMs / 1000 : 0;
    segments.push({ start, duration, text: text.replace(/\s+/g, ' ').trim() });
  }

  return segments;
}

function parseVttTimestamp(value: string): number | null {
  const parts = value.trim().split(':');
  if (parts.length < 2) return null;
  const secondsPart = parts.pop();
  if (!secondsPart) return null;
  const [secPart, msPart = '0'] = secondsPart.split('.');
  const seconds = Number(secPart);
  const millis = Number(msPart.padEnd(3, '0'));
  const minutes = Number(parts.pop() ?? '0');
  const hours = parts.length > 0 ? Number(parts.pop() ?? '0') : 0;
  if ([seconds, millis, minutes, hours].some(num => Number.isNaN(num))) return null;
  return hours * 3600 + minutes * 60 + seconds + millis / 1000;
}

export function parseTranscriptVtt(payload: string): TranscriptSegment[] {
  const lines = payload.split(/\r?\n/);
  const segments: TranscriptSegment[] = [];
  let index = 0;

  while (index < lines.length) {
    const lineRaw = lines[index];
    if (!lineRaw) {
      index += 1;
      continue;
    }
    const line = lineRaw.trim();
    if (!line || line.startsWith('WEBVTT') || line.startsWith('Kind:') || line.startsWith('Language:')) {
      index += 1;
      continue;
    }

    if (line.includes('-->')) {
      const [startRaw = '', endRaw = ''] = line.split('-->').map(part => part.trim());
      const start = parseVttTimestamp(startRaw);
      const end = parseVttTimestamp(endRaw.split(' ')[0] ?? '');
      index += 1;
      const textLines: string[] = [];
      while (index < lines.length) {
        const textLine = lines[index];
        if (!textLine || textLine.trim() === '') break;
        textLines.push(textLine.trim());
        index += 1;
      }
      const text = textLines.join(' ').replace(/\s+/g, ' ').trim();
      if (start !== null && text) {
        const duration = end !== null && end >= start ? end - start : 0;
        segments.push({ start, duration, text });
      }
      continue;
    }

    index += 1;
  }

  return segments;
}

function parseTimecode(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.endsWith('s')) {
    const seconds = Number(trimmed.slice(0, -1));
    return Number.isNaN(seconds) ? null : seconds;
  }
  const parts = trimmed.split(':');
  const secondsPart = parts.pop();
  if (!secondsPart) return null;
  const [secPart, msPart = '0'] = secondsPart.split('.');
  const seconds = Number(secPart);
  const millis = Number(msPart.padEnd(3, '0'));
  const minutes = parts.length > 0 ? Number(parts.pop() ?? '0') : 0;
  const hours = parts.length > 0 ? Number(parts.pop() ?? '0') : 0;
  if ([seconds, millis, minutes, hours].some(num => Number.isNaN(num))) return null;
  return hours * 3600 + minutes * 60 + seconds + millis / 1000;
}

export function parseTranscriptTtml(payload: string): TranscriptSegment[] {
  const segments: TranscriptSegment[] = [];
  const matches = payload.matchAll(/<p\b([^>]*)>([\s\S]*?)<\/p>/g);

  for (const match of matches) {
    const attrs = match[1] ?? '';
    const textRaw = match[2] ?? '';
    const attrRegex = /(\w+)="([^"]*)"/g;
    const attrMap: Record<string, string> = {};
    let attrMatch: RegExpExecArray | null;
    while ((attrMatch = attrRegex.exec(attrs)) !== null) {
      const key = attrMatch[1];
      if (!key) continue;
      attrMap[key] = attrMatch[2] ?? '';
    }

    const startRaw = attrMap['begin'] ?? attrMap['start'] ?? '';
    const endRaw = attrMap['end'] ?? '';
    const durRaw = attrMap['dur'] ?? '';
    const start = parseTimecode(startRaw);
    const end = parseTimecode(endRaw);
    const durationFromDur = durRaw ? parseTimecode(durRaw) : null;
    const duration =
      end !== null && start !== null ? end - start : (durationFromDur ?? 0);

    const text = decodeXmlEntities(textRaw)
      .replace(/<[^>]+>/g, '')
      .replace(/\s+/g, ' ')
      .trim();

    if (start !== null && text) {
      segments.push({ start, duration: Math.max(0, duration), text });
    }
  }

  return segments;
}
