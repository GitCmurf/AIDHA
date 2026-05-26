// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 Colin Farmer (GitCmurf)

import { createHash } from 'node:crypto';
import type { MediaSegment } from '@aidha/praecis-core';
import { normalizeText } from '@aidha/praecis-core';
import type { TextExtractionOptions, TextExtractionResult } from './types.js';

const BLOCK_TAGS = new Set([
  'article',
  'aside',
  'blockquote',
  'div',
  'footer',
  'header',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'li',
  'main',
  'p',
  'pre',
  'section',
  'td',
  'th',
  'tr',
]);

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&amp;/gi, '&');
}

function segmentId(sourceId: string | undefined, index: number, text: string): string {
  return createHash('sha256')
    .update(`text:${sourceId ?? 'anonymous'}:${index}:${text}`)
    .digest('hex')
    .slice(0, 16);
}

function pushSegment(
  segments: MediaSegment[],
  text: string,
  startOffset: number,
  sourceId?: string,
  label?: string,
): number {
  const normalized = normalizeText(text);
  if (normalized.length === 0) {
    return startOffset;
  }

  const endOffset = startOffset + normalized.length;
  segments.push({
    id: segmentId(sourceId, segments.length, normalized),
    locator: { kind: 'text', charStart: startOffset, charEnd: endOffset },
    text: normalized,
    ...(label ? { label } : {}),
  });

  return endOffset + 2;
}

function stripDangerousBlocks(html: string): string {
  return html
    .replace(/<script\b[\s\S]*?<\/script(?:\s[^>]*)?>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style(?:\s[^>]*)?>/gi, ' ')
    .replace(/<noscript\b[\s\S]*?<\/noscript(?:\s[^>]*)?>/gi, ' ')
    .replace(/<!--[\s\S]*?--!?>/g, ' ');
}

function tokenize(html: string): string[] {
  return html.match(/<[^>]+>|[^<]+/g) ?? [];
}

function tagName(token: string): string | null {
  const match = token.match(/^<\/?\s*([a-z0-9-]+)/i);
  return match ? match[1]!.toLowerCase() : null;
}

function isClosingTag(token: string): boolean {
  return /^<\//.test(token);
}

function isSelfClosingTag(token: string): boolean {
  return /\/>$/.test(token) || /^<br\b/i.test(token) || /^<hr\b/i.test(token);
}

function extractBlocksFromHtml(html: string): Array<{ text: string; label?: string }> {
  const cleaned = stripDangerousBlocks(html);
  const tokens = tokenize(cleaned);
  const blocks: Array<{ text: string; label?: string }> = [];
  let current = '';
  let currentLabel: string | undefined;
  let insideTitle = false;
  let seenTextInCurrentBlock = false;

  const flush = () => {
    const normalized = normalizeText(current);
    if (normalized.length > 0) {
      blocks.push({ text: normalized, ...(currentLabel ? { label: currentLabel } : {}) });
    }
    current = '';
    currentLabel = undefined;
    seenTextInCurrentBlock = false;
  };

  for (const token of tokens) {
    if (token.startsWith('<')) {
      const name = tagName(token);
      if (!name) {
        continue;
      }

      if (name === 'title') {
        if (!isClosingTag(token)) {
          insideTitle = true;
          currentLabel = 'title';
        } else {
          insideTitle = false;
          flush();
        }
        continue;
      }

      if (name === 'br' || name === 'hr' || BLOCK_TAGS.has(name)) {
        if (!isClosingTag(token) || isSelfClosingTag(token)) {
          flush();
          if (!isClosingTag(token) && /^h[1-6]$/.test(name)) {
            currentLabel = name;
          }
        }
      }
      continue;
    }

    const text = decodeHtmlEntities(token);
    if (insideTitle && current.length === 0 && text.trim().length > 0) {
      currentLabel = 'title';
    }
    current += text;
    if (text.trim().length > 0) {
      seenTextInCurrentBlock = true;
    }
  }

  if (seenTextInCurrentBlock || normalizeText(current).length > 0) {
    flush();
  }

  return blocks;
}

function extractBlocksFromPlainText(text: string): Array<{ text: string }> {
  return text
    .split(/\r?\n\s*\r?\n/g)
    .map(block => normalizeText(block))
    .filter(Boolean)
    .map(block => ({ text: block }));
}

function buildSegments(
  blocks: Array<{ text: string; label?: string }>,
  options: TextExtractionOptions = {},
): TextExtractionResult {
  const segments: MediaSegment[] = [];
  let offset = 0;
  const parts: string[] = [];

  for (const block of blocks) {
    if (block.text.length === 0) {
      continue;
    }
    parts.push(block.text);
    offset = pushSegment(segments, block.text, offset, options.sourceId, block.label);
  }

  return {
    text: parts.join('\n\n'),
    segments,
  };
}

export function extractTextFromHtml(
  html: string,
  options: TextExtractionOptions = {},
): TextExtractionResult {
  return buildSegments(extractBlocksFromHtml(html), options);
}

export function extractTextFromPlainText(
  text: string,
  options: TextExtractionOptions = {},
): TextExtractionResult {
  return buildSegments(extractBlocksFromPlainText(text), options);
}

export function extractTextFromPdfText(
  text: string,
  options: TextExtractionOptions = {},
): TextExtractionResult {
  return extractTextFromPlainText(text, options);
}
