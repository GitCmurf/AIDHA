// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 Colin Farmer (GitCmurf)

import { createHash } from 'node:crypto';
import type {
  AudioRef,
  Chunk,
  DecodeInput,
  DecodeOutput,
  ExtractionContext,
  IChunker,
  IContextProvider,
  IDecodeStrategy,
  IDiarizer,
  IIngestor,
  ITranscriber,
  IngestInput,
  MediaSegment,
  RawSource,
  Result,
  TimecodedSegment,
  VectorRuntimeContext,
} from '@aidha/praecis-core';
import { normalizeText, urlCanonical, composeVector, transcribeStrategy, TokenWindowChunker, ConversationChunker } from '@aidha/praecis-core';
import { extractTextFromHtml } from '@aidha/praecis-decode-text';
import { MockTranscriber, type MockTranscriberConfig } from '@aidha/praecis-decode-transcribe';
import { MockDiarizer, type MockDiarizerConfig } from '@aidha/praecis-decode-diarize';
import type { ResolvedConfig, SourceRegistration } from '@aidha/config';

export interface PodcastFetchResponse {
  readonly ok: boolean;
  readonly url: string;
  readonly status: number;
  text(): Promise<string>;
  arrayBuffer(): Promise<ArrayBuffer>;
}

export type PodcastFetchFn = (
  url: string,
  init?: { redirect?: 'follow' | 'manual' },
) => Promise<PodcastFetchResponse>;

export interface PodcastItem {
  readonly guid?: string;
  readonly title: string;
  readonly link?: string;
  readonly description?: string;
  readonly contentHtml?: string;
  readonly categories: readonly string[];
  readonly publishedAt?: string;
  readonly enclosureUrl?: string;
  readonly enclosureType?: string;
  readonly enclosureLength?: string;
}

export interface PodcastPayload {
  readonly uri: string;
  readonly mimeType: string;
  readonly feedUrl: string;
  readonly feedTitle: string;
  readonly item: PodcastItem;
  readonly enclosureUrl?: string;
  readonly showNotesUrl?: string;
  readonly showNotesHtml?: string;
  readonly panel: boolean;
}

export interface PodcastIngestorOptions {
  readonly fetchFn?: PodcastFetchFn;
}

export interface PodcastVectorOptions {
  readonly fetchFn?: PodcastFetchFn;
  readonly transcriber?: ITranscriber;
  readonly diarizer?: IDiarizer;
  readonly mockTranscriber?: MockTranscriberConfig;
  readonly mockDiarizer?: MockDiarizerConfig;
}

function stableId(seed: string): string {
  return createHash('sha256').update(seed).digest('hex').slice(0, 16);
}

function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function normalizeBytes(value: Uint8Array | ArrayBuffer): Uint8Array {
  return value instanceof Uint8Array ? value : new Uint8Array(value);
}

function parseTag(xml: string, tag: string): string | undefined {
  const match = xml.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'i'));
  if (!match?.[1]) return undefined;
  return match[1].trim();
}

function parseAttribute(block: string, attribute: string): string | undefined {
  const match = block.match(new RegExp(`${attribute}="([^"]+)"`, 'i'));
  return match?.[1]?.trim();
}

function parsePodcastItem(xml: string): PodcastItem {
  const title = parseTag(xml, 'title') ?? 'Untitled episode';
  const link = parseTag(xml, 'link');
  const guid = parseTag(xml, 'guid');
  const description = parseTag(xml, 'description');
  const contentHtml = parseTag(xml, 'content:encoded');
  const categories = Array.from(xml.matchAll(/<category[^>]*>([\s\S]*?)<\/category>/gi))
    .map(match => match[1]!.trim())
    .filter(Boolean);
  const publishedAt = parseTag(xml, 'pubDate');
  const enclosureBlock = xml.match(/<enclosure\b[^>]*\/?>/i)?.[0];
  const enclosureUrl = enclosureBlock ? parseAttribute(enclosureBlock, 'url') : undefined;
  const enclosureType = enclosureBlock ? parseAttribute(enclosureBlock, 'type') : undefined;
  const enclosureLength = enclosureBlock ? parseAttribute(enclosureBlock, 'length') : undefined;

  return { title, link, guid, description, contentHtml, categories, publishedAt, enclosureUrl, enclosureType, enclosureLength };
}

function parsePodcastFeed(xml: string): { feedTitle: string; items: PodcastItem[] } {
  const feedTitle = parseTag(xml, 'title') ?? 'Podcast feed';
  const items = Array.from(xml.matchAll(/<item\b[\s\S]*?<\/item>/gi)).map(match => parsePodcastItem(match[0]!));
  return { feedTitle, items };
}

function isPanelEpisode(item: PodcastItem): boolean {
  const haystack = [item.title, item.description ?? '', item.contentHtml ?? '', ...item.categories].join(' ').toLowerCase();
  return /\bpanel\b|\broundtable\b|\bdiscussion\b/.test(haystack);
}

function chooseEpisode(items: PodcastItem[], episodeGuid?: string): PodcastItem | undefined {
  if (episodeGuid) {
    return items.find(item => item.guid === episodeGuid) ?? items[0];
  }
  return items[0];
}

function mediaTypeFromEnclosure(item: PodcastItem, enclosureUrl: string): string {
  if (item.enclosureType && item.enclosureType.trim().length > 0) {
    return item.enclosureType.trim();
  }
  const lower = enclosureUrl.toLowerCase();
  if (lower.endsWith('.mp3')) return 'audio/mpeg';
  if (lower.endsWith('.m4a') || lower.endsWith('.mp4')) return 'audio/mp4';
  if (lower.endsWith('.wav')) return 'audio/wav';
  if (lower.endsWith('.aac')) return 'audio/aac';
  if (lower.endsWith('.ogg') || lower.endsWith('.oga')) return 'audio/ogg';
  return 'audio/mpeg';
}

function summarizeShowNotes(item: PodcastItem, showNotesHtml?: string): string {
  const notesText = showNotesHtml ? extractTextFromHtml(showNotesHtml).text : '';
  return [item.title, notesText || item.description || '']
    .map(value => normalizeText(value))
    .filter(Boolean)
    .join(' — ');
}

async function fetchText(fetchFn: PodcastFetchFn, url: string): Promise<string> {
  const response = await fetchFn(url, { redirect: 'follow' });
  if (!response.ok) {
    throw new Error(`podcast fetch failed for ${url}: HTTP ${response.status}`);
  }
  return response.text();
}

async function fetchBytes(fetchFn: PodcastFetchFn, url: string): Promise<Uint8Array> {
  const response = await fetchFn(url, { redirect: 'follow' });
  if (!response.ok) {
    throw new Error(`podcast enclosure fetch failed for ${url}: HTTP ${response.status}`);
  }
  return normalizeBytes(await response.arrayBuffer());
}

class PodcastContextProvider implements IContextProvider {
  async build(raw: RawSource, _config: ResolvedConfig): Promise<ExtractionContext> {
    const payload = raw.payload as PodcastPayload | undefined;
    if (!payload) {
      return {};
    }

    return {
      sourceSummary: summarizeShowNotes(payload.item, payload.showNotesHtml),
      topicsOfInterest: payload.item.categories.length > 0 ? [...payload.item.categories] : undefined,
      chunkingHints: payload.panel ? ['conversation'] : ['prose'],
    };
  }
}

class PodcastChunker implements IChunker {
  readonly name = 'podcast';

  private readonly tokenWindow = new TokenWindowChunker();
  private readonly conversation = new ConversationChunker();

  async chunk(input: { readonly segments: readonly MediaSegment[]; readonly context: ExtractionContext }): Promise<Result<Chunk[]>> {
    const hasSpeakers = input.segments.some(segment => segment.locator.kind === 'timecode' && Boolean(segment.locator.speaker));
    return hasSpeakers ? this.conversation.chunk(input) : this.tokenWindow.chunk(input);
  }
}

class PodcastDiarizeStrategy implements IDecodeStrategy {
  readonly name = 'diarize:podcast';

  constructor(private readonly diarizer: IDiarizer) {}

  async decode(input: DecodeInput): Promise<Result<DecodeOutput>> {
    const payload = input.raw.payload as PodcastPayload | undefined;
    if (!payload?.panel) {
      return {
        ok: true,
        value: {
          segments: [...(input.upstream ?? [])],
          warnings: [],
        },
      };
    }

    if (!input.upstream || input.upstream.length === 0) {
      return {
        ok: false,
        error: new Error('PodcastDiarizeStrategy expected upstream timecoded segments'),
      };
    }

    const timecodedSegments: TimecodedSegment[] = input.upstream.map(segment => {
      if (segment.locator.kind !== 'timecode') {
        throw new Error(`PodcastDiarizeStrategy expected timecode segments, got ${segment.locator.kind}`);
      }
      return {
        id: segment.id,
        startSec: segment.locator.startSec,
        endSec: segment.locator.endSec,
        text: segment.text ?? '',
        speaker: segment.locator.speaker,
      };
    });

    const audio: AudioRef = { uri: payload.uri, mimeType: payload.mimeType };
    const diarized = await this.diarizer.diarize(audio, timecodedSegments);
    if (!diarized.ok) {
      return diarized;
    }

    return {
      ok: true,
      value: {
        segments: diarized.value.map(segment => ({
          id: segment.id,
          locator: {
            kind: 'timecode' as const,
            startSec: segment.startSec,
            endSec: segment.endSec,
            speaker: segment.speaker,
          },
          text: segment.text,
          label: segment.speaker,
        })),
        warnings: [],
      },
    };
  }
}

export class PodcastIngestor implements IIngestor<PodcastPayload> {
  readonly sourceId = 'podcast';

  constructor(private readonly options: PodcastIngestorOptions = {}) {}

  async acquire(input: IngestInput, runtimeContext: VectorRuntimeContext): Promise<Result<RawSource & { payload: PodcastPayload }>> {
    try {
      const fetchFn = this.options.fetchFn ?? globalThis.fetch.bind(globalThis);
      const feedResponse = await fetchFn(input.ref, { redirect: 'follow' });
      if (!feedResponse.ok) {
        return { ok: false, error: new Error(`podcast feed fetch failed for ${input.ref}: HTTP ${feedResponse.status}`) };
      }

      const xml = await feedResponse.text();
      const { feedTitle, items } = parsePodcastFeed(xml);
      const episodeGuid = typeof input.metadata?.['episodeGuid'] === 'string' ? input.metadata['episodeGuid'] : undefined;
      const item = chooseEpisode(items, episodeGuid);
      if (!item) {
        return { ok: false, error: new Error(`podcast feed has no episodes: ${input.ref}`) };
      }

      const enclosureUrl = item.enclosureUrl?.trim();
      if (!enclosureUrl) {
        return { ok: false, error: new Error(`podcast episode has no enclosure URL: ${item.title}`) };
      }

      const enclosureBytes = await fetchBytes(fetchFn, enclosureUrl);
      const enclosureHash = sha256Hex(enclosureBytes);
      const showNotesUrl = item.link?.trim() || undefined;
      let showNotesHtml = item.contentHtml ?? item.description ?? '';
      if (showNotesUrl) {
        try {
          showNotesHtml = await fetchText(fetchFn, showNotesUrl);
        } catch {
          // Keep the feed-provided notes when the show-notes page is unavailable.
        }
      }

      const panel = typeof input.metadata?.['panel'] === 'boolean' ? Boolean(input.metadata?.['panel']) : isPanelEpisode(item);
      const audio: AudioRef = {
        uri: `podcast:${stableId(enclosureUrl ?? enclosureHash)}`,
        mimeType: mediaTypeFromEnclosure(item, enclosureUrl),
      };
      const canonicalId = enclosureUrl ? `podcast:${enclosureUrl}` : `podcast:${enclosureHash}`;
      const dedupKeys = new Set<string>([input.ref, feedResponse.url || input.ref, enclosureUrl, urlCanonical(enclosureUrl), `content-sha256:${enclosureHash}`].filter((value): value is string => typeof value === 'string' && value.length > 0));
      if (item.guid) {
        dedupKeys.add(item.guid);
      }
      if (showNotesUrl) {
        dedupKeys.add(showNotesUrl);
        dedupKeys.add(urlCanonical(showNotesUrl));
      }

      return {
        ok: true,
        value: {
          canonicalId,
          dedupKeys: Array.from(dedupKeys),
          sourceType: 'podcast',
          sensitivity: 'public',
          provenance: {
            sourceUri: enclosureUrl,
            ingestedAt: runtimeContext.clock.now().toISOString(),
            sourceType: 'podcast',
          },
          resourceMetadata: {
            title: item.title,
            episodeTitle: item.title,
            feedTitle,
            feedUrl: input.ref,
            ...(item.guid ? { guid: item.guid } : {}),
            enclosureUrl,
            enclosureSha256: enclosureHash,
            mimeType: audio.mimeType,
            ...(showNotesUrl ? { showNotesUrl } : {}),
            panel,
            ...(item.publishedAt ? { publishedAt: item.publishedAt } : {}),
            ...(item.categories.length > 0 ? { categories: [...item.categories] } : {}),
          },
          payload: {
            uri: audio.uri,
            mimeType: audio.mimeType,
            feedUrl: input.ref,
            feedTitle,
            item,
            enclosureUrl,
            showNotesUrl,
            showNotesHtml,
            panel,
          },
          label: item.title,
        },
      };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error : new Error(String(error)) };
    }
  }
}

export const PodcastSourceRegistration: SourceRegistration = {
  sourceId: 'podcast',
  validateActiveSourceConfig: (value: unknown) => value,
};

export function createPodcastVectorSpec(options: PodcastVectorOptions = {}) {
  const transcriber = options.transcriber ?? new MockTranscriber(options.mockTranscriber ?? { transcriptText: 'podcast transcript sample' });
  const diarizer = options.diarizer ?? new MockDiarizer(options.mockDiarizer ?? {});
  const vectorOptions = { ...(options.fetchFn ? { fetchFn: options.fetchFn } : {}) };

  return composeVector({
    sourceId: 'podcast',
    sensitivity: 'public',
    ingestor: new PodcastIngestor(vectorOptions),
    decode: [transcribeStrategy(transcriber), new PodcastDiarizeStrategy(diarizer)],
    context: new PodcastContextProvider(),
    chunking: new PodcastChunker(),
    registration: PodcastSourceRegistration,
  });
}
