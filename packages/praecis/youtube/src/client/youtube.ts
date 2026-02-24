/**
 * Real YouTube client implementation.
 *
 * Uses oEmbed API for metadata and Innertube API for transcripts
 * (same approach as youtube-transcript-api Python library).
 */
import { createHash } from 'node:crypto';
import type { YouTubeClient, Result } from './types.js';
import type { Video, Playlist, Transcript } from '../schema/index.js';
import type { TranscriptSegment } from './transcript.js';
import {
  decodeXmlEntities,
  parseTranscriptJson,
  parseTranscriptVtt,
  parseTranscriptXml,
} from './transcript.js';
import { fetchTranscriptWithYtDlp } from './yt-dlp.js';
import type { YtDlpRuntimeConfig } from './yt-dlp.js';

// ── Runtime Config ───────────────────────────────────────────────────────────

/** Configuration for the YouTube client, typically derived from ResolvedConfig. */
export interface YouTubeClientConfig {
  cookie?: string;
  innertubeApiKey?: string;
  debugTranscript: boolean;
}

/** Default client config (no environment-variable lookup). */
export function youtubeDefaultConfig(): YouTubeClientConfig {
  return {
    cookie: undefined,
    innertubeApiKey: undefined,
    debugTranscript: false,
  };
}

/** Build a YouTubeClientConfig from process.env (legacy/fallback). */
export function youtubeConfigFromEnv(): YouTubeClientConfig {
  return {
    cookie:
      process.env['YOUTUBE_COOKIE'] ??
      process.env['YOUTUBE_COOKIES'] ??
      process.env['AIDHA_YOUTUBE_COOKIE'],
    innertubeApiKey: process.env['YOUTUBE_INNERTUBE_API_KEY'],
    debugTranscript: process.env['AIDHA_DEBUG_TRANSCRIPT'] === '1',
  };
}

// Innertube API configuration
const INNERTUBE_CLIENT_VERSION = '2.20240101.00.00';

const DEFAULT_HEADERS: Record<string, string> = {
  'User-Agent':
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept-Language': 'en-US,en;q=0.9',
  Accept: '*/*',
};

function consentHeaders(ytCfg: YouTubeClientConfig): Record<string, string> {
  const cookie = ytCfg.cookie;
  return {
    ...DEFAULT_HEADERS,
    Cookie: cookie
      ? (cookie.includes('CONSENT=') ? cookie : `CONSENT=YES+1; SOCS=CAI; ${cookie}`)
      : 'CONSENT=YES+1; SOCS=CAI',
  };
}

function buildTranscriptHeaders(ytCfg: YouTubeClientConfig, videoId?: string): Record<string, string> {
  const authHeader = buildSapisidHash(ytCfg, 'https://www.youtube.com');
  if (!videoId) {
    return {
      ...consentHeaders(ytCfg),
      ...(authHeader ? { Authorization: authHeader } : {}),
    };
  }
  return {
    ...consentHeaders(ytCfg),
    Referer: `https://www.youtube.com/watch?v=${videoId}`,
    Origin: 'https://www.youtube.com',
    ...(authHeader ? { Authorization: authHeader } : {}),
  };
}

function getCookieValue(cookie: string, name: string): string | undefined {
  const match = cookie.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return match?.[1];
}

function buildSapisidHash(ytCfg: YouTubeClientConfig, origin: string): string | undefined {
  const cookie = ytCfg.cookie;
  if (!cookie) return undefined;
  const sapisid =
    getCookieValue(cookie, 'SAPISID') ??
    getCookieValue(cookie, '__Secure-3PAPISID') ??
    getCookieValue(cookie, 'APISID');
  if (!sapisid) {
    if (ytCfg.debugTranscript) {
      // eslint-disable-next-line no-console
      console.log('[transcript] cookie missing SAPISID/APISID');
    }
    return undefined;
  }
  const timestamp = Math.floor(Date.now() / 1000);
  const digest = createHash('sha1')
    .update(`${timestamp} ${sapisid} ${origin}`)
    .digest('hex');
  return `SAPISIDHASH ${timestamp}_${digest}`;
}

/**
 * Parse YouTube video ID from various URL formats.
 */
function parseVideoId(input: string): string {
  if (!input.includes('/') && !input.includes('.')) {
    return input;
  }

  try {
    const url = new URL(input);
    if (url.searchParams.has('v')) {
      return url.searchParams.get('v')!;
    }
    if (url.hostname === 'youtu.be') {
      return url.pathname.slice(1);
    }
    if (url.pathname.startsWith('/embed/')) {
      return url.pathname.slice(7);
    }
  } catch {
    // Not a URL, treat as ID
  }

  return input;
}

/**
 * Create Innertube API request context.
 */
function createInnertubeContext() {
  return {
    client: {
      hl: 'en',
      gl: 'US',
      clientName: 'WEB',
      clientVersion: INNERTUBE_CLIENT_VERSION,
    },
  };
}

/**
 * Fetch video metadata using oEmbed API.
 */
async function fetchOEmbed(videoId: string): Promise<Result<{
  title: string;
  author_name: string;
  author_url?: string;
  thumbnail_url: string;
}>> {
  try {
    const url = `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`;
    const response = await fetch(url);

    if (!response.ok) {
      return { ok: false, error: new Error(`oEmbed failed: ${response.status}`) };
    }

    const data = await response.json() as {
      title: string;
      author_name: string;
      author_url?: string;
      thumbnail_url: string;
    };

    return { ok: true, value: data };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error : new Error(String(error)) };
  }
}

/**
 * Parse channel identifier from oEmbed author URL.
 */
function parseChannelId(authorUrl?: string): string {
  if (!authorUrl) return '';

  try {
    const url = new URL(authorUrl);
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts.length >= 2 && parts[0] === 'channel') {
      return parts[1] ?? '';
    }
    if (parts.length >= 1) {
      return parts[parts.length - 1] ?? '';
    }
  } catch {
    // Ignore malformed URLs
  }

  return '';
}

type CaptionTrack = {
  baseUrl: string;
  languageCode: string;
  name: string;
  kind?: string;
};

function parseTimedTextTracks(xml: string, videoId: string): CaptionTrack[] {
  const tracks: CaptionTrack[] = [];
  const trackRegex = /<track\s+([^>]+?)\s*\/>/g;
  let match: RegExpExecArray | null;
  while ((match = trackRegex.exec(xml)) !== null) {
    const attrs = match[1] ?? '';
    const attrRegex = /(\w+)="([^"]*)"/g;
    const attrMap: Record<string, string> = {};
    let attrMatch: RegExpExecArray | null;
    while ((attrMatch = attrRegex.exec(attrs)) !== null) {
      const key = attrMatch[1];
      if (!key) continue;
      attrMap[key] = decodeXmlEntities(attrMatch[2] ?? '');
    }
    const languageCode = attrMap['lang_code'];
    if (!languageCode) continue;
    const name = attrMap['name'] || attrMap['lang_original'] || languageCode;
    const kind = attrMap['kind'];
    const baseUrl = new URL('https://www.youtube.com/api/timedtext');
    baseUrl.searchParams.set('v', videoId);
    baseUrl.searchParams.set('lang', languageCode);
    if (attrMap['name']) {
      baseUrl.searchParams.set('name', attrMap['name']);
    }
    if (kind) {
      baseUrl.searchParams.set('kind', kind);
    }
    baseUrl.searchParams.set('fmt', 'srv3');
    tracks.push({ baseUrl: baseUrl.toString(), languageCode, name, kind });
  }
  return tracks;
}

async function tryDirectTimedText(
  videoId: string,
  languageCode: string,
  ytCfg: YouTubeClientConfig,
  kind?: string
): Promise<CaptionTrack | null> {
  try {
    const url = new URL('https://www.youtube.com/api/timedtext');
    url.searchParams.set('v', videoId);
    url.searchParams.set('lang', languageCode);
    if (kind) {
      url.searchParams.set('kind', kind);
    }
    url.searchParams.set('fmt', 'srv3');
    const candidates = buildTranscriptUrls(url.toString());
    for (const candidate of candidates) {
      const result = await fetchTranscriptSegments(candidate, videoId, ytCfg);
      if (ytCfg.debugTranscript && result.segments.length === 0) {
        const preview = result.payload.slice(0, 120).replace(/\s+/g, ' ');
        // eslint-disable-next-line no-console
        console.log(
          `[transcript] timedtext fmt=${result.fmt ?? 'default'} status=${result.status} ` +
          `length=${result.payload.length} content-type=${result.contentType ?? ''} ` +
          `content-length=${result.contentLength ?? ''} url=${result.finalUrl} preview=${preview}`
        );
      }
      if (result.segments.length > 0) {
        return {
          baseUrl: candidate,
          languageCode,
          name: kind === 'asr' ? `${languageCode} (auto)` : languageCode,
          kind,
        };
      }
    }
    return null;
  } catch {
    return null;
  }
}

async function fetchCaptionTracksFromTimedText(
  videoId: string,
  ytCfg: YouTubeClientConfig,
): Promise<Result<CaptionTrack[]>> {
  try {
    const listUrl = `https://www.youtube.com/api/timedtext?type=list&v=${videoId}`;
    const response = await fetch(listUrl, { headers: buildTranscriptHeaders(ytCfg, videoId) });
    if (!response.ok) {
      return { ok: false, error: new Error(`Timedtext list failed: ${response.status}`) };
    }
    const xml = await response.text();
    if (ytCfg.debugTranscript) {
      const preview = xml.slice(0, 240).replace(/\s+/g, ' ');
      // eslint-disable-next-line no-console
      console.log(`[transcript] timedtext list status=${response.status} length=${xml.length}`);
      // eslint-disable-next-line no-console
      console.log(`[transcript] timedtext list preview: ${preview}`);
    }
    const tracks = parseTimedTextTracks(xml, videoId);
    if (tracks.length === 0) {
      const autoTrack = await tryDirectTimedText(videoId, 'en', ytCfg, 'asr');
      if (autoTrack) {
        return { ok: true, value: [autoTrack] };
      }
      const manualTrack = await tryDirectTimedText(videoId, 'en', ytCfg);
      if (manualTrack) {
        return { ok: true, value: [manualTrack] };
      }
      return { ok: false, error: new Error(`No captions available for ${videoId}`) };
    }
    return { ok: true, value: tracks };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error : new Error(String(error)) };
  }
}

function findMarkerIndex(html: string, markers: string[], startIndex = 0): number {
  let best = -1;
  for (const marker of markers) {
    const idx = html.indexOf(marker, startIndex);
    if (idx === -1) continue;
    if (best === -1 || idx < best) {
      best = idx;
    }
  }
  return best;
}

function extractJsonObjectFromIndex(html: string, startIndex: number): Record<string, unknown> | null {
  const braceStart = html.indexOf('{', startIndex);
  if (braceStart === -1) return null;

  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = braceStart; i < html.length; i += 1) {
    const char = html[i];
    if (inString) {
      if (escape) {
        escape = false;
      } else if (char === '\\') {
        escape = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }
    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === '{') {
      depth += 1;
    } else if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        const jsonText = html.slice(braceStart, i + 1);
        try {
          return JSON.parse(jsonText) as Record<string, unknown>;
        } catch {
          return null;
        }
      }
    }
  }

  return null;
}

function readQuotedString(html: string, startIndex: number): { value: string; endIndex: number } | null {
  const quote = html[startIndex];
  if (quote !== '"') return null;
  let escape = false;
  for (let i = startIndex + 1; i < html.length; i += 1) {
    const char = html[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (char === '\\') {
      escape = true;
      continue;
    }
    if (char === quote) {
      const raw = html.slice(startIndex, i + 1);
      try {
        const value = JSON.parse(raw) as string;
        return { value, endIndex: i + 1 };
      } catch {
        return null;
      }
    }
  }
  return null;
}

function extractJsonFromJsonParse(html: string, markerIndex: number): Record<string, unknown> | null {
  const window = html.slice(markerIndex, markerIndex + 1200);
  const parseOffset = window.indexOf('JSON.parse(');
  if (parseOffset === -1) return null;
  const absoluteParseIndex = markerIndex + parseOffset;
  const quoteIndex = html.indexOf('"', absoluteParseIndex);
  if (quoteIndex === -1) return null;
  const quoted = readQuotedString(html, quoteIndex);
  if (!quoted) return null;
  try {
    return JSON.parse(quoted.value) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function maskTranscriptUrl(value: string): string {
  try {
    const url = new URL(value);
    const masked = new URL(url.toString());
    const secrets = ['signature', 'sig', 's', 'lsig', 'expire'];
    for (const secret of secrets) {
      if (masked.searchParams.has(secret)) {
        masked.searchParams.set(secret, '***');
      }
    }
    return masked.toString();
  } catch {
    return value;
  }
}

function buildTranscriptUrls(baseUrl: string): string[] {
  const urls: string[] = [];
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    return [];
  }
  const existingFmt = url.searchParams.get('fmt');
  const formats = ['srv3', 'json3', 'vtt'];

  if (existingFmt) {
    urls.push(url.toString());
  }

  for (const fmt of formats) {
    if (fmt === existingFmt) continue;
    const formatted = new URL(url.toString());
    formatted.searchParams.set('fmt', fmt);
    urls.push(formatted.toString());
  }

  if (existingFmt) {
    const withoutFmt = new URL(url.toString());
    withoutFmt.searchParams.delete('fmt');
    urls.push(withoutFmt.toString());
  }

  return Array.from(new Set(urls));
}

function parseTranscriptPayload(payload: string, fmt?: string | null): TranscriptSegment[] {
  if (fmt === 'json3') {
    return parseTranscriptJson(payload);
  }
  if (fmt === 'vtt') {
    return parseTranscriptVtt(payload);
  }
  const xmlSegments = parseTranscriptXml(payload);
  if (xmlSegments.length > 0) return xmlSegments;
  const jsonSegments = parseTranscriptJson(payload);
  if (jsonSegments.length > 0) return jsonSegments;
  return parseTranscriptVtt(payload);
}

async function fetchTranscriptSegments(
  url: string,
  videoId: string,
  ytCfg: YouTubeClientConfig,
): Promise<{
  segments: TranscriptSegment[];
  payload: string;
  status: number;
  contentType: string | null;
  finalUrl: string;
  contentLength: string | null;
  fmt: string | null;
}> {
  const response = await fetch(url, { headers: buildTranscriptHeaders(ytCfg, videoId) });
  const payload = await response.text();
  const fmt = new URL(url).searchParams.get('fmt');
  const segments =
    response.ok && payload.length > 0
      ? parseTranscriptPayload(payload, fmt)
      : [];
  return {
    segments,
    payload,
    status: response.status,
    contentType: response.headers.get('content-type'),
    finalUrl: response.url,
    contentLength: response.headers.get('content-length'),
    fmt,
  };
}

function extractPlayerResponse(html: string): Record<string, unknown> | null {
  const markers = ['ytInitialPlayerResponse =', 'ytInitialPlayerResponse='];
  const startIndex = findMarkerIndex(html, markers);
  if (startIndex === -1) return null;

  const jsonParsed = extractJsonFromJsonParse(html, startIndex);
  if (jsonParsed) return jsonParsed;

  return extractJsonObjectFromIndex(html, startIndex);
}

function extractInitialData(html: string): Record<string, unknown> | null {
  const markers = [
    'ytInitialData =',
    'ytInitialData=',
    'window["ytInitialData"] =',
    'window["ytInitialData"]='
  ];
  const startIndex = findMarkerIndex(html, markers);
  if (startIndex === -1) return null;

  const jsonParsed = extractJsonFromJsonParse(html, startIndex);
  if (jsonParsed) return jsonParsed;

  return extractJsonObjectFromIndex(html, startIndex);
}

function extractYtcfg(html: string): Record<string, unknown> | undefined {
  const marker = 'ytcfg.set(';
  let searchIndex = 0;
  while (true) {
    const idx = html.indexOf(marker, searchIndex);
    if (idx === -1) return undefined;
    const config = extractJsonObjectFromIndex(html, idx);
    if (config && typeof config === 'object' && config['INNERTUBE_API_KEY']) {
      return config;
    }
    searchIndex = idx + marker.length;
  }
}

function findTranscriptParamsFromData(data: unknown): string | null {
  if (!data) return null;
  const queue: unknown[] = [data];

  while (queue.length > 0) {
    const node = queue.shift();
    if (!node) continue;
    if (Array.isArray(node)) {
      queue.push(...node);
      continue;
    }
    if (typeof node !== 'object') continue;
    const record = node as Record<string, unknown>;
    const endpoint = record['getTranscriptEndpoint'] as Record<string, unknown> | undefined;
    if (endpoint && typeof endpoint === 'object') {
      const params = endpoint['params'];
      if (typeof params === 'string') return params;
    }
    for (const value of Object.values(record)) {
      queue.push(value);
    }
  }

  return null;
}

function extractTranscriptParams(html: string): string | null {
  const initialData = extractInitialData(html);
  const fromInitial = findTranscriptParamsFromData(initialData);
  if (fromInitial) return fromInitial;

  const playerResponse = extractPlayerResponse(html);
  const fromPlayer = findTranscriptParamsFromData(playerResponse);
  if (fromPlayer) return fromPlayer;

  const marker = '"getTranscriptEndpoint":';
  const startIndex = html.indexOf(marker);
  if (startIndex === -1) return null;
  const paramsKey = '"params":';
  const paramsIndex = html.indexOf(paramsKey, startIndex);
  if (paramsIndex === -1) return null;
  const quoteIndex = html.indexOf('"', paramsIndex + paramsKey.length);
  if (quoteIndex === -1) return null;
  const quoted = readQuotedString(html, quoteIndex);
  return quoted?.value ?? null;
}

function extractCueText(cue: Record<string, unknown> | undefined): string {
  if (!cue) return '';
  const simpleText = cue['simpleText'];
  if (typeof simpleText === 'string') return simpleText;
  const runs = cue['runs'];
  if (Array.isArray(runs)) {
    return runs.map(run => (typeof run?.text === 'string' ? run.text : '')).join('');
  }
  return '';
}

function buildInnertubeContext(ytcfg?: Record<string, unknown>): Record<string, unknown> {
  const base =
    (ytcfg?.['INNERTUBE_CONTEXT'] as Record<string, unknown> | undefined)
    ?? (createInnertubeContext() as Record<string, unknown>);
  const client = { ...(base['client'] as Record<string, unknown> | undefined) };
  const request = { ...(base['request'] as Record<string, unknown> | undefined) };
  const visitorData = ytcfg?.['VISITOR_DATA'] as string | undefined;

  if (!client['hl']) client['hl'] = 'en';
  if (!client['gl']) client['gl'] = 'US';
  if (!client['clientName']) client['clientName'] = 'WEB';
  if (!client['clientVersion']) client['clientVersion'] = INNERTUBE_CLIENT_VERSION;
  if (visitorData && !client['visitorData']) client['visitorData'] = visitorData;
  if (!client['userAgent']) client['userAgent'] = DEFAULT_HEADERS['User-Agent'];
  if (request['useSsl'] === undefined) request['useSsl'] = true;

  return {
    ...base,
    client,
    request,
  };
}

function normalizeClientName(value: unknown): string {
  if (typeof value === 'number') return String(value);
  if (typeof value === 'string') {
    if (/^\d+$/.test(value)) return value;
    if (value.toUpperCase() === 'WEB') return '1';
  }
  return '1';
}

function parseTranscriptFromGetTranscript(data: unknown): TranscriptSegment[] {
  const segments: TranscriptSegment[] = [];
  const queue: unknown[] = [data];

  while (queue.length > 0) {
    const node = queue.shift();
    if (!node) continue;
    if (Array.isArray(node)) {
      queue.push(...node);
      continue;
    }
    if (typeof node !== 'object') continue;

    const record = node as Record<string, unknown>;
    const cueGroup = record['transcriptCueGroupRenderer'] as Record<string, unknown> | undefined;
    const cues = cueGroup?.['cues'];
    if (Array.isArray(cues)) {
      for (const cue of cues) {
        if (!cue || typeof cue !== 'object') continue;
        const cueRecord = cue as Record<string, unknown>;
        const renderer = (cueRecord['transcriptCueRenderer'] as Record<string, unknown> | undefined) ?? cueRecord;
        const startMs = Number(renderer['startOffsetMs'] ?? renderer['startTimeMs'] ?? 0);
        const durationMs = Number(renderer['durationMs'] ?? 0);
        const text = extractCueText(renderer['cue'] as Record<string, unknown> | undefined);
        if (!text.trim()) continue;
        segments.push({
          start: Number.isNaN(startMs) ? 0 : startMs / 1000,
          duration: Number.isNaN(durationMs) ? 0 : durationMs / 1000,
          text: text.replace(/\s+/g, ' ').trim(),
        });
      }
    }

    for (const value of Object.values(record)) {
      queue.push(value);
    }
  }

  segments.sort((a, b) => a.start - b.start);
  return segments;
}

async function fetchTranscriptFromGetTranscript(
  videoId: string,
  ytCfg: YouTubeClientConfig,
): Promise<Result<TranscriptSegment[]>> {
  try {
    const response = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
      headers: consentHeaders(ytCfg),
    });
    if (!response.ok) {
      return { ok: false, error: new Error(`Video page failed: ${response.status}`) };
    }
    const html = await response.text();
    const params = extractTranscriptParams(html);
    if (!params) {
      return { ok: false, error: new Error(`Transcript params not found for ${videoId}`) };
    }
    if (ytCfg.debugTranscript) {
      // eslint-disable-next-line no-console
      console.log(`[transcript] get_transcript params length=${params.length}`);
    }
    const ytcfg = extractYtcfg(html);
    const apiKey = (ytcfg?.['INNERTUBE_API_KEY'] as string | undefined) ?? ytCfg.innertubeApiKey;
    if (!apiKey) {
      return { ok: false, error: new Error(`Innertube API key missing for ${videoId}`) };
    }
    const context = buildInnertubeContext(ytcfg);
    const clientName = normalizeClientName(ytcfg?.['INNERTUBE_CLIENT_NAME']);
    const clientVersion = ytcfg?.['INNERTUBE_CLIENT_VERSION'] ?? INNERTUBE_CLIENT_VERSION;
    const visitorData = ytcfg?.['VISITOR_DATA'] as string | undefined;
    const origin = 'https://www.youtube.com';
    const authHeader = buildSapisidHash(ytCfg, origin);
    if (ytCfg.debugTranscript) {
      // eslint-disable-next-line no-console
      console.log(
        `[transcript] get_transcript clientName=${clientName} clientVersion=${clientVersion} ` +
        `visitorData=${visitorData ? 'yes' : 'no'}`
      );
      if (!ytCfg.cookie) {
        // eslint-disable-next-line no-console
        console.log('[transcript] get_transcript cookie missing');
      }
    }

    const transcriptResponse = await fetch(
      `https://www.youtube.com/youtubei/v1/get_transcript?key=${apiKey}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          ...DEFAULT_HEADERS,
          Referer: `https://www.youtube.com/watch?v=${videoId}`,
          Origin: origin,
          'X-Origin': origin,
          'X-Goog-AuthUser': '0',
          'X-Youtube-Client-Name': String(clientName),
          'X-Youtube-Client-Version': String(clientVersion),
          ...(visitorData ? { 'X-Goog-Visitor-Id': visitorData } : {}),
          ...(authHeader ? { Authorization: authHeader } : {}),
        },
        body: JSON.stringify({
          context,
          params,
          contentCheckOk: true,
          racyCheckOk: true,
        }),
      }
    );

    if (!transcriptResponse.ok) {
      if (ytCfg.debugTranscript) {
        const errorText = await transcriptResponse.text();
        const preview = errorText.slice(0, 200).replace(/\s+/g, ' ');
        // eslint-disable-next-line no-console
        console.log(
          `[transcript] get_transcript status=${transcriptResponse.status} ` +
          `content-type=${transcriptResponse.headers.get('content-type') ?? ''} preview=${preview}`
        );
      }
      return { ok: false, error: new Error(`get_transcript failed: ${transcriptResponse.status}`) };
    }

    const data = await transcriptResponse.json() as unknown;
    const segments = parseTranscriptFromGetTranscript(data);
    if (segments.length === 0) {
      return { ok: false, error: new Error(`get_transcript returned no cues for ${videoId}`) };
    }

    return { ok: true, value: segments };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error : new Error(String(error)) };
  }
}

async function fetchCaptionTracksFromInnertube(
  videoId: string,
  apiKey: string,
  ytCfg: YouTubeClientConfig,
  context?: Record<string, unknown>
): Promise<Result<CaptionTrack[]>> {
  try {
    const authHeader = buildSapisidHash(ytCfg, 'https://www.youtube.com');
    const response = await fetch(
      `https://www.youtube.com/youtubei/v1/player?key=${apiKey}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...DEFAULT_HEADERS,
          ...(authHeader ? { Authorization: authHeader } : {}),
        },
        body: JSON.stringify({
          context: context ?? createInnertubeContext(),
          videoId,
        }),
      }
    );

    if (!response.ok) {
      return { ok: false, error: new Error(`Innertube failed: ${response.status}`) };
    }

    const data = await response.json() as {
      captions?: {
        playerCaptionsTracklistRenderer?: {
          captionTracks?: Array<{
            baseUrl: string;
            languageCode: string;
            name?: { simpleText?: string };
            kind?: string;
          }>;
        };
      };
    };

    const tracks = data.captions?.playerCaptionsTracklistRenderer?.captionTracks;
    if (!tracks || tracks.length === 0) {
      return { ok: false, error: new Error(`No captions available for ${videoId}`) };
    }

    return {
      ok: true,
      value: tracks.map(t => ({
        baseUrl: t.baseUrl,
        languageCode: t.languageCode,
        name: t.name?.simpleText ?? t.languageCode,
        kind: t.kind,
      })),
    };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error : new Error(String(error)) };
  }
}

async function fetchCaptionTracksFromHtml(
  videoId: string,
  ytCfg: YouTubeClientConfig,
): Promise<Result<CaptionTrack[]>> {
  try {
    const response = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
      headers: consentHeaders(ytCfg),
    });
    if (!response.ok) {
      return { ok: false, error: new Error(`Video page failed: ${response.status}`) };
    }
    const html = await response.text();
    if (ytCfg.debugTranscript) {
      // eslint-disable-next-line no-console
      console.log(`[transcript] html status=${response.status} length=${html.length}`);
    }
    const player = extractPlayerResponse(html);
    const captions = (player?.['captions'] as Record<string, unknown> | undefined)
      ?.['playerCaptionsTracklistRenderer'] as Record<string, unknown> | undefined;
    const tracks = captions?.['captionTracks'] as Array<{
      baseUrl: string;
      languageCode: string;
      name?: { simpleText?: string };
      kind?: string;
    }> | undefined;
    if (tracks && tracks.length > 0) {
      return {
        ok: true,
        value: tracks.map(t => ({
          baseUrl: t.baseUrl,
          languageCode: t.languageCode,
          name: t.name?.simpleText ?? t.languageCode,
          kind: t.kind,
        })),
      };
    }

    const ytcfg = extractYtcfg(html);
    const apiKey = ytcfg?.['INNERTUBE_API_KEY'] as string | undefined;
    const context = ytcfg?.['INNERTUBE_CONTEXT'] as Record<string, unknown> | undefined;
    if (apiKey) {
      const innertubeResult = await fetchCaptionTracksFromInnertube(videoId, apiKey, ytCfg, context);
      if (innertubeResult.ok) return innertubeResult;
    }

    return { ok: false, error: new Error(`No captions available for ${videoId}`) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error : new Error(String(error)) };
  }
}

/**
 * Extract caption tracks from video page using Innertube player response.
 */
async function fetchCaptionTracks(
  videoId: string,
  ytCfg: YouTubeClientConfig,
): Promise<Result<CaptionTrack[]>> {
  if (!ytCfg.innertubeApiKey) {
    const htmlFallback = await fetchCaptionTracksFromHtml(videoId, ytCfg);
    if (htmlFallback.ok) return htmlFallback;
    return fetchCaptionTracksFromTimedText(videoId, ytCfg);
  }

  const innertubeResult = await fetchCaptionTracksFromInnertube(videoId, ytCfg.innertubeApiKey, ytCfg);
  if (innertubeResult.ok) return innertubeResult;
  const htmlFallback = await fetchCaptionTracksFromHtml(videoId, ytCfg);
  if (htmlFallback.ok) return htmlFallback;
  return fetchCaptionTracksFromTimedText(videoId, ytCfg);
}

/**
 * Real YouTube client using Innertube API (same approach as youtube-transcript-api).
 */
export class RealYouTubeClient implements YouTubeClient {
  private readonly ytCfg: YouTubeClientConfig;
  private readonly ytDlpCfg?: YtDlpRuntimeConfig;

  constructor(
    ytConfig?: YouTubeClientConfig,
    ytDlpConfig?: YtDlpRuntimeConfig,
  ) {
    this.ytCfg = ytConfig ?? youtubeDefaultConfig();
    this.ytDlpCfg = ytDlpConfig;
  }

  /**
   * Fetch playlist - not supported without Data API key.
   */
  async fetchPlaylist(playlistId: string): Promise<Result<Playlist>> {
    return {
      ok: false,
      error: new Error(
        `Playlist fetching requires YouTube Data API key. ` +
        `Consider providing video IDs directly instead.`
      ),
    };
  }

  /**
   * Fetch video metadata using oEmbed.
   */
  async fetchVideo(videoIdOrUrl: string): Promise<Result<Video>> {
    const videoId = parseVideoId(videoIdOrUrl);

    try {
      const oembedResult = await fetchOEmbed(videoId);
      if (!oembedResult.ok) {
        return { ok: false, error: oembedResult.error };
      }

      const { title, author_name, author_url, thumbnail_url } = oembedResult.value;
      const channelId = parseChannelId(author_url) || author_name;

      const video: Video = {
        id: videoId,
        title,
        channelId,
        channelName: author_name,
        duration: 0,
        publishedAt: new Date().toISOString(),
        description: undefined,
        thumbnailUrl: thumbnail_url,
      };

      return { ok: true, value: video };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error : new Error(String(error)) };
    }
  }

  /**
   * Fetch video transcript using Innertube API (like youtube-transcript-api).
   */
  async fetchTranscript(videoIdOrUrl: string): Promise<Result<Transcript>> {
    const videoId = parseVideoId(videoIdOrUrl);

    try {
      // Get caption tracks via Innertube API
      const tracksResult = await fetchCaptionTracks(videoId, this.ytCfg);
      if (!tracksResult.ok) {
        return { ok: false, error: tracksResult.error };
      }

      const tracks = tracksResult.value;

      // Find English track (prefer non-ASR, fallback to first)
      const englishTracks = tracks.filter(t => t.languageCode.startsWith('en'));
      const englishTrack =
        englishTracks.find(t => t.kind !== 'asr') ??
        englishTracks[0] ??
        tracks[0];
      if (!englishTrack) {
        return { ok: false, error: new Error(`No caption track found for ${videoId}`) };
      }

      const transcriptUrls = buildTranscriptUrls(englishTrack.baseUrl);
      if (this.ytCfg.debugTranscript) {
        // eslint-disable-next-line no-console
        console.log(`[transcript] track url: ${maskTranscriptUrl(transcriptUrls[0] ?? '')}`);
      }

      let segments: TranscriptSegment[] = [];
      let lastPayload = '';
      let lastStatus = 0;
      let lastContentType: string | null = null;

      for (const candidate of transcriptUrls) {
        const result = await fetchTranscriptSegments(candidate, videoId, this.ytCfg);
        segments = result.segments;
        lastPayload = result.payload;
        lastStatus = result.status;
        lastContentType = result.contentType;
        if (segments.length > 0) break;
        if (this.ytCfg.debugTranscript) {
          const preview = result.payload.slice(0, 120).replace(/\s+/g, ' ');
          // eslint-disable-next-line no-console
          console.log(
            `[transcript] attempt fmt=${result.fmt ?? 'default'} status=${result.status} ` +
            `length=${result.payload.length} content-type=${result.contentType ?? ''} ` +
            `content-length=${result.contentLength ?? ''} url=${result.finalUrl} preview=${preview}`
          );
        }
      }

      if (segments.length === 0) {
        const directTrack = await tryDirectTimedText(
          videoId,
          englishTrack.languageCode,
          this.ytCfg,
          englishTrack.kind,
        );
        if (directTrack) {
          const directUrls = buildTranscriptUrls(directTrack.baseUrl);
          for (const candidate of directUrls) {
            const result = await fetchTranscriptSegments(candidate, videoId, this.ytCfg);
            segments = result.segments;
            lastPayload = result.payload;
            lastStatus = result.status;
            lastContentType = result.contentType;
            if (segments.length > 0) break;
            if (this.ytCfg.debugTranscript) {
              const preview = result.payload.slice(0, 120).replace(/\s+/g, ' ');
              // eslint-disable-next-line no-console
              console.log(
                `[transcript] direct fmt=${result.fmt ?? 'default'} status=${result.status} ` +
                `length=${result.payload.length} content-type=${result.contentType ?? ''} ` +
                `content-length=${result.contentLength ?? ''} url=${result.finalUrl} preview=${preview}`
              );
            }
          }
        }
      }

      let lastError: Error | null = null;

      if (segments.length === 0) {
        const transcriptResult = await fetchTranscriptFromGetTranscript(videoId, this.ytCfg);
        if (transcriptResult.ok) {
          segments = transcriptResult.value;
        } else {
          lastError = transcriptResult.error;
          if (this.ytCfg.debugTranscript) {
            // eslint-disable-next-line no-console
            console.log(`[transcript] get_transcript error: ${transcriptResult.error.message}`);
          }
        }
      }

      if (segments.length === 0) {
        const ytdlpResult = await fetchTranscriptWithYtDlp(videoId, this.ytDlpCfg);
        if (ytdlpResult.ok) {
          segments = ytdlpResult.value.segments;
        } else {
          lastError = ytdlpResult.error;
          if (this.ytCfg.debugTranscript) {
            // eslint-disable-next-line no-console
            console.log(`[transcript] yt-dlp error: ${ytdlpResult.error.message}`);
          }
        }
      }

      if (this.ytCfg.debugTranscript && segments.length === 0) {
        const preview = lastPayload.slice(0, 240).replace(/\s+/g, ' ');
        // eslint-disable-next-line no-console
        console.log(`[transcript] body preview: ${preview}`);
        // eslint-disable-next-line no-console
        console.log(
          `[transcript] transcript status=${lastStatus} ` +
          `length=${lastPayload.length} content-type=${lastContentType ?? ''}`
        );
      }

      if (segments.length === 0) {
        const suffix = lastError ? ` (${lastError.message})` : '';
        return { ok: false, error: new Error(`No transcript segments found for ${videoId}${suffix}`) };
      }

      const fullText = segments.map(s => s.text).join(' ');

      const transcript: Transcript = {
        videoId,
        language: englishTrack.languageCode,
        segments,
        fullText,
      };

      return { ok: true, value: transcript };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error : new Error(String(error)) };
    }
  }

  /**
   * Fetch video with transcript together.
   */
  async fetchVideoWithTranscript(videoIdOrUrl: string): Promise<Result<{
    video: Video;
    transcript: Transcript | null;
  }>> {
    const videoResult = await this.fetchVideo(videoIdOrUrl);
    if (!videoResult.ok) {
      return { ok: false, error: videoResult.error };
    }

    const transcriptResult = await this.fetchTranscript(videoIdOrUrl);

    return {
      ok: true,
      value: {
        video: videoResult.value,
        transcript: transcriptResult.ok ? transcriptResult.value : null,
      },
    };
  }
}
