// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 Colin Farmer (GitCmurf)

import type { MediaSegment, Locator, Result } from '@aidha/praecis-core';

export interface OcrImageRef {
  readonly uri: string;
  readonly mimeType: string;
  readonly page?: number;
}

export interface OcrLine {
  readonly text: string;
  readonly confidence?: number;
}

export interface OcrBlock {
  readonly lines: readonly OcrLine[];
}

export interface OcrInput {
  readonly image: OcrImageRef;
  readonly blocks?: readonly OcrBlock[];
}

export interface OcrResult {
  readonly text: string;
  readonly segments: readonly MediaSegment[];
}

export interface IOcrEngine {
  readonly backend: string;
  ocr(input: OcrInput): Promise<Result<OcrResult>>;
}

export interface MockOcrEngineConfig {
  readonly backend?: string;
  readonly blocks?: readonly OcrBlock[];
  readonly text?: string;
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function textLocator(startChar: number, text: string, page?: number): Locator {
  return {
    kind: 'text',
    charStart: startChar,
    charEnd: startChar + text.length,
  };
}

function blocksToLines(blocks: readonly OcrBlock[], fallbackText?: string): OcrLine[] {
  const lines = blocks.flatMap(block => block.lines);
  if (lines.length > 0) {
    return lines;
  }
  if (fallbackText && fallbackText.trim().length > 0) {
    return [{ text: fallbackText }];
  }
  return [];
}

function segmentsFromLines(lines: readonly OcrLine[]): OcrResult {
  const segments: MediaSegment[] = [];
  let offset = 0;
  const parts: string[] = [];

  for (const [index, line] of lines.entries()) {
    const text = normalizeText(line.text);
    if (text.length === 0) {
      continue;
    }

    parts.push(text);
    const locator = textLocator(offset, text);
    segments.push({
      id: `ocr-${index}`,
      locator,
      text,
    });
    offset += text.length + 2;
  }

  return {
    text: parts.join('\n\n'),
    segments,
  };
}

export class MockOcrEngine implements IOcrEngine {
  readonly backend: string;

  constructor(private readonly config: MockOcrEngineConfig = {}) {
    this.backend = config.backend ?? 'mock';
  }

  async ocr(input: OcrInput): Promise<Result<OcrResult>> {
    const lines = blocksToLines(input.blocks ?? this.config.blocks ?? [], this.config.text ?? input.image.uri);
    return { ok: true, value: segmentsFromLines(lines) };
  }
}

export function ocrBlocksToResult(blocks: readonly OcrBlock[], fallbackText?: string): OcrResult {
  return segmentsFromLines(blocksToLines(blocks, fallbackText));
}
