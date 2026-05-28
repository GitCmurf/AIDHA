// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 Colin Farmer (GitCmurf)

import { describe, expect, it } from 'vitest';
import {
  extractTextFromHtml,
  extractTextFromPlainText,
  extractTextFromPdfText,
} from '../src/index.js';

describe('extractTextFromHtml', () => {
  it('strips script and style content and preserves block order', () => {
    const result = extractTextFromHtml(`
      <html>
        <head>
          <style>body { color: red; }</style>
          <script>window.evil = true;</script>
        </head>
        <body>
          <h1>Title &amp; heading</h1>
          <p>First paragraph.</p>
          <p>Second <strong>paragraph</strong>.</p>
        </body>
      </html>
    `, { sourceId: 'web:https://example.com/article' });

    expect(result.text).toBe('Title & heading\n\nFirst paragraph.\n\nSecond paragraph.');
    expect(result.segments).toHaveLength(3);
    const firstLength = result.segments[0]!.text!.length;
    const secondLength = result.segments[1]!.text!.length;
    const thirdLength = result.segments[2]!.text!.length;
    expect(result.segments[0]!.locator).toEqual({ kind: 'text', charStart: 0, charEnd: firstLength });
    expect(result.segments[1]!.locator).toEqual({
      kind: 'text',
      charStart: firstLength + 2,
      charEnd: firstLength + 2 + secondLength,
    });
    expect(result.segments[2]!.locator).toEqual({
      kind: 'text',
      charStart: firstLength + secondLength + 4,
      charEnd: firstLength + secondLength + 4 + thirdLength,
    });
    expect(result.segments[0]!.label).toBe('h1');
  });

  it('emits deterministic ids for identical inputs', () => {
    const html = '<p>Alpha</p><p>Beta</p>';
    const first = extractTextFromHtml(html);
    const second = extractTextFromHtml(html);
    expect(first.segments.map(segment => segment.id)).toEqual(second.segments.map(segment => segment.id));
  });
});

describe('extractTextFromPlainText', () => {
  it('splits on blank lines and normalizes whitespace', () => {
    const result = extractTextFromPlainText('Alpha\n  beta\n\nGamma   delta');
    expect(result.text).toBe('Alpha beta\n\nGamma delta');
    expect(result.segments).toHaveLength(2);
    const firstLength = result.segments[0]!.text!.length;
    const secondLength = result.segments[1]!.text!.length;
    expect(result.segments[0]!.locator).toEqual({ kind: 'text', charStart: 0, charEnd: firstLength });
    expect(result.segments[1]!.locator).toEqual({
      kind: 'text',
      charStart: firstLength + 2,
      charEnd: firstLength + 2 + secondLength,
    });
  });
});

describe('extractTextFromPdfText', () => {
  it('aliases the plain-text path', () => {
    const pdf = extractTextFromPdfText('One\n\nTwo');
    const plain = extractTextFromPlainText('One\n\nTwo');
    expect(pdf).toEqual(plain);
  });
});
