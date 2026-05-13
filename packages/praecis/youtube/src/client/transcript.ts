export type TranscriptSegment = { start: number; duration: number; text: string; speaker?: string };
type TranscriptJsonSegment = { utf8?: string };
type TranscriptJsonEvent = {
  tStartMs?: number;
  dDurationMs?: number;
  segs?: TranscriptJsonSegment[];
};
type TranscriptJson = { events?: TranscriptJsonEvent[] };

function normalizeTranscriptText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function stripMarkupTags(value: string): string {
  let result = '';
  let i = 0;
  while (i < value.length) {
    if (value[i] === '<') {
      const next = value[i + 1];
      if (next === '/' || (next !== undefined && next >= 'A' && next <= 'Z') || (next !== undefined && next >= 'a' && next <= 'z')) {
        let j = i + 1;
        while (j < value.length && value[j] !== '>') j++;
        if (j < value.length) {
          i = j + 1;
          continue;
        }
      }
    }
    result += value[i];
    i++;
  }
  return result;
}

function parseVttVoiceTag(text: string): Pick<TranscriptSegment, 'text' | 'speaker'> | null {
  const match = text.match(/^<v\s+([^>]+)>([\s\S]*?)(?:<\/v>)?$/u);
  if (!match) return null;

  const speaker = normalizeTranscriptText(match[1] ?? '');
  const body = normalizeTranscriptText(stripMarkupTags(match[2] ?? ''));
  if (!speaker || !body) return null;
  return { speaker, text: body };
}

function buildTranscriptSegment(input: {
  start: number;
  duration: number;
  text: string;
  allowVoiceTag?: boolean;
}): TranscriptSegment | null {
  const normalized = normalizeTranscriptText(input.text);
  if (!normalized) return null;

  // Only WebVTT cues with explicit <v Speaker> tags are treated as speaker-attributed.
  // XML/JSON/TTML text is preserved verbatim so prose labels like "Definition:" remain intact.
  const parsed = input.allowVoiceTag ? parseVttVoiceTag(normalized) : null;

  return {
    start: input.start,
    duration: input.duration,
    ...(parsed ?? { text: stripMarkupTags(normalized) }),
  };
}

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
    const text = stripMarkupTags(decodeXmlEntities(match[3] ?? ''));

    const segment = buildTranscriptSegment({ start, duration, text });
    if (segment) segments.push(segment);
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
    const start = typeof event?.tStartMs === 'number' ? event.tStartMs / 1000 : 0;
    const duration = typeof event?.dDurationMs === 'number' ? event.dDurationMs / 1000 : 0;
    const segment = buildTranscriptSegment({
      start,
      duration,
      text: segs.map((segmentPart: TranscriptJsonSegment) => segmentPart?.utf8 ?? '').join(''),
    });
    if (segment) segments.push(segment);
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
      const text = textLines.join(' ');
      if (start !== null) {
        const duration = end !== null && end >= start ? end - start : 0;
        const segment = buildTranscriptSegment({ start, duration, text, allowVoiceTag: true });
        if (segment) segments.push(segment);
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

    const text = stripMarkupTags(decodeXmlEntities(textRaw));

    if (start !== null) {
      const segment = buildTranscriptSegment({ start, duration: Math.max(0, duration), text });
      if (segment) segments.push(segment);
    }
  }

  return segments;
}
