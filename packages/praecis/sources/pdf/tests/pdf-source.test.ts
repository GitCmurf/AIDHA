// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 Colin Farmer (GitCmurf)

import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { composeVector } from '@aidha/praecis-core';
import {
  PdfIngestor,
  PdfOcrDecodeStrategy,
  PdfTextDecodeStrategy,
  createPdfVectorSpec,
} from '../src/index.js';
import type { ResolvedConfig } from '@aidha/config';

const runtimeContext = {
  config: {} as ResolvedConfig,
  clock: { now: () => new Date('2026-05-25T12:34:56.000Z') },
};

function makeTempPdf(contents: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'aidha-pdf-'));
  const file = join(dir, 'sample.pdf');
  writeFileSync(file, contents, 'utf8');
  return file;
}

describe('PdfIngestor', () => {
  it('hashes file bytes into a canonical pdf identity', async () => {
    const file = makeTempPdf('Page one\fPage two');
    try {
      const ingestor = new PdfIngestor();
      const result = await ingestor.acquire({ ref: file }, runtimeContext);

      expect(result.ok).toBe(true);
      if (!result.ok) throw result.error;

      const expectedHash = createHash('sha256').update(Buffer.from('Page one\fPage two', 'utf8')).digest('hex');
      expect(result.value.canonicalId).toBe(`pdf:${expectedHash}`);
      expect(result.value.payload.pages).toHaveLength(2);
      expect(result.value.resourceMetadata).toMatchObject({
        title: 'sample.pdf',
        filePath: file,
        sha256: expectedHash,
        pageCount: 2,
        documentKind: 'slides',
      });
    } finally {
      rmSync(file, { force: true });
      rmSync(join(file, '..'), { recursive: true, force: true });
    }
  });
});

describe('PdfTextDecodeStrategy', () => {
  it('emits page locators for text-layer pages', async () => {
    const strategy = new PdfTextDecodeStrategy();
    const result = await strategy.decode({
      raw: {
        canonicalId: 'pdf:abc',
        sourceType: 'pdf',
        sensitivity: 'personal',
        provenance: { ingestedAt: '2026-05-22T00:00:00.000Z', sourceType: 'pdf' },
        payload: {
          filePath: '/tmp/sample.pdf',
          title: 'sample.pdf',
          sha256: 'abc',
          pages: [
            { pageNumber: 1, text: 'First page' },
            { pageNumber: 2, text: 'Second page' },
          ],
        },
        label: 'sample.pdf',
      },
      config: {} as Parameters<PdfTextDecodeStrategy['decode']>[0]['config'],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw result.error;
    expect(result.value.segments).toHaveLength(2);
    expect(result.value.segments[0]!.locator).toEqual({ kind: 'page', page: 1, charStart: 0, charEnd: 10 });
  });
});

describe('PdfOcrDecodeStrategy', () => {
  it('fills pages without a text layer using OCR blocks', async () => {
    const strategy = new PdfOcrDecodeStrategy();
    const result = await strategy.decode({
      raw: {
        canonicalId: 'pdf:abc',
        sourceType: 'pdf',
        sensitivity: 'personal',
        provenance: { ingestedAt: '2026-05-22T00:00:00.000Z', sourceType: 'pdf' },
        payload: {
          filePath: '/tmp/sample.pdf',
          title: 'sample.pdf',
          sha256: 'abc',
          pages: [
            { pageNumber: 1, text: 'First page' },
            { pageNumber: 2, ocrBlocks: [{ lines: [{ text: 'OCR text' }] }] },
          ],
        },
        label: 'sample.pdf',
      },
      upstream: [{ id: 'pdf-page-1', locator: { kind: 'page', page: 1, charStart: 0, charEnd: 10 }, text: 'First page' }],
      config: {} as Parameters<PdfOcrDecodeStrategy['decode']>[0]['config'],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw result.error;
    expect(result.value.segments).toHaveLength(2);
    expect(result.value.segments[1]!.locator).toEqual({ kind: 'page', page: 2, charStart: 0, charEnd: 8 });
  });
});

describe('createPdfVectorSpec', () => {
  it('uses the injected clock for provenance timestamps', async () => {
    const file = makeTempPdf('Clocked page');
    try {
      const vector = composeVector(createPdfVectorSpec());
      const first = await vector.ingestAndDecode({ ref: file }, runtimeContext);
      const second = await vector.ingestAndDecode({ ref: file }, runtimeContext);

      expect(first.ok).toBe(true);
      expect(second.ok).toBe(true);
      if (!first.ok) throw first.error;
      if (!second.ok) throw second.error;
      expect(first.value.raw.provenance.ingestedAt).toBe('2026-05-25T12:34:56.000Z');
      expect(second.value.raw.provenance).toEqual(first.value.raw.provenance);
    } finally {
      rmSync(file, { force: true });
      rmSync(join(file, '..'), { recursive: true, force: true });
    }
  });

  it('builds a composed pdf vector that decodes page text', async () => {
    const file = makeTempPdf('Alpha\fBeta');
    try {
      const vector = composeVector(createPdfVectorSpec());
      const result = await vector.ingestAndDecode({ ref: file }, runtimeContext);

      expect(result.ok).toBe(true);
      if (!result.ok) throw result.error;
      expect(result.value.raw.canonicalId.startsWith('pdf:')).toBe(true);
      expect(result.value.segments).toHaveLength(2);
    } finally {
      rmSync(file, { force: true });
      rmSync(join(file, '..'), { recursive: true, force: true });
    }
  });
});
