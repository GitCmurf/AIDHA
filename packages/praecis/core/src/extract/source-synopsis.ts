// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 Colin Farmer (GitCmurf)

import type {
  Chunk,
  DraftClaim,
  Locator,
  SourceSynopsisEvidenceRef,
  SourceSynopsisItem,
} from '../interfaces/index.js';

export interface BuildSourceSynopsisInput {
  readonly sourceId: string;
  readonly canonicalId: string;
  readonly sourceUri?: string;
  readonly resourceId: string;
  readonly claims: readonly DraftClaim[];
  readonly chunks: readonly Chunk[];
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function capitalizeSentence(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return trimmed;
  return `${trimmed.charAt(0).toUpperCase()}${trimmed.slice(1)}`;
}

function stripReportedSpeechWrapper(text: string): { readonly text: string; readonly attribution?: string } {
  const normalized = normalizeWhitespace(text);
  const match = /^(?:the\s+)?(?:speaker|host|presenter|demonstrator)\s+(?:claims?|says?|states?|suggests?|recommends?|reports?|explains?)\s+(?:that\s+)?(.+)$/i.exec(normalized);
  if (!match?.[1]) return { text: normalized };
  return {
    text: capitalizeSentence(match[1].replace(/[.。]?$/, '.')),
    attribution: 'source',
  };
}

function correctCommonAttribution(text: string): string {
  return text
    .replace(/\bClaude Code['’]s Karpathy prompt\b/g, "Karpathy's Claude Code prompt");
}

function hasCategorySoupList(text: string): boolean {
  const listMatch = /\bsuch as\b(.+)$/i.exec(text);
  if (!listMatch?.[1]) return false;
  const listItems = listMatch[1].split(/\s*,\s*|\s+and\s+/).map(item => item.trim()).filter(Boolean);
  if (listItems.length < 5) return false;
  const namedItems = listItems.filter(item => /\b[A-Z][A-Za-z0-9]*(?:\s+[A-Z][A-Za-z0-9]*){0,3}\b/.test(item));
  return namedItems.length >= 5 && /\b(?:uses?|navigate|navigation|backlinks?|tags?|categories|concepts)\b/i.test(text);
}

function synopsisKindForClaim(claim: DraftClaim): SourceSynopsisItem['kind'] {
  const raw = `${claim.type ?? claim.classification ?? ''}`.toLowerCase();
  switch (raw) {
    case 'instruction':
      return 'workflow';
    case 'mechanism':
      return 'mechanism';
    case 'warning':
      return 'limitation';
    case 'opinion':
      return 'tradeoff';
    case 'decision':
    case 'recommendation':
      return 'recommendation';
    case 'insight':
      return 'pattern';
    default:
      return 'context';
  }
}

function secondsForLocator(locator: Locator): { readonly start: number; readonly end: number } | undefined {
  if (locator.kind !== 'timecode') return undefined;
  return {
    start: Math.max(0, Number(locator.startSec.toFixed(2))),
    end: Math.max(0, Number(locator.endSec.toFixed(2))),
  };
}

function localTranscriptRef(resourceId: string, excerptId: string, locator: Locator): string {
  const seconds = secondsForLocator(locator);
  if (!seconds) return `${resourceId}#${excerptId}`;
  return `${resourceId}#${excerptId}@${seconds.start}-${seconds.end}s`;
}

function sourceRefForLocator(_sourceId: string, sourceUri: string | undefined, _canonicalId: string, _locator: Locator): string | undefined {
  return sourceUri;
}

function entitiesForText(text: string): readonly string[] | undefined {
  const entities = Array.from(new Set(text.match(/\b[A-Z][A-Za-z0-9]*(?:\s+[A-Z][A-Za-z0-9]*){0,3}\b/g) ?? []))
    .filter(entity => !/^(?:The|This|When|Using|As|April|For|If)$/.test(entity))
    .slice(0, 8);
  return entities.length > 0 ? entities : undefined;
}

function usefulRationale(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = normalizeWhitespace(value);
  if (!normalized || /^(?:direct report|direct example|the speaker|the host|the presenter|the demonstrator)\b/i.test(normalized)) {
    return undefined;
  }
  return normalized;
}

function sourceSynopsisTextForClaim(claim: DraftClaim): { readonly text: string; readonly attribution?: string } | null {
  const corrected = correctCommonAttribution(claim.text);
  if (hasCategorySoupList(corrected)) return null;
  const stripped = stripReportedSpeechWrapper(corrected);
  if (/^(?:the\s+)?(?:speaker|host|presenter|demonstrator)\b/i.test(stripped.text)) return null;
  return stripped;
}

export function buildSourceSynopsis(input: BuildSourceSynopsisInput): readonly SourceSynopsisItem[] {
  const chunkById = new Map(input.chunks.map(chunk => [chunk.id, chunk]));
  const seen = new Set<string>();
  const items: SourceSynopsisItem[] = [];

  for (const claim of input.claims) {
    if (claim.metadata?.['qualityStatus'] === 'rejected') continue;

    const synopsis = sourceSynopsisTextForClaim(claim);
    if (!synopsis) continue;

    const evidenceRefs: SourceSynopsisEvidenceRef[] = claim.excerptIds.flatMap(excerptId => {
      const chunk = chunkById.get(excerptId);
      if (!chunk) return [];
      const sourceRef = sourceRefForLocator(input.sourceId, input.sourceUri, input.canonicalId, chunk.locator);
      return [{
        excerptId,
        locator: chunk.locator,
        localTranscriptRef: localTranscriptRef(input.resourceId, excerptId, chunk.locator),
        ...(sourceRef ? { sourceRef } : {}),
      }];
    });
    if (evidenceRefs.length === 0) continue;

    const text = normalizeWhitespace(synopsis.text);
    const duplicateKey = text.toLowerCase();
    if (!text || seen.has(duplicateKey)) continue;
    seen.add(duplicateKey);

    const rationale = usefulRationale(claim.metadata?.['rationale'] ?? claim.metadata?.['supportSummary']);
    const entities = entitiesForText(text);
    items.push({
      text,
      kind: synopsisKindForClaim(claim),
      evidenceRefs,
      ...(synopsis.attribution ? { attribution: synopsis.attribution } : {}),
      ...(rationale ? { rationale } : {}),
      ...(entities ? { entities } : {}),
    });
  }

  return items;
}
