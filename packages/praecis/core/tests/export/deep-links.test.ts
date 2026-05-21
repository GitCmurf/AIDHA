// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 Colin Farmer (GitCmurf)

import { describe, it, expect } from 'vitest';
import { renderDeepLink, renderLabel } from '../../src/export/deep-links.js';
import type { Locator } from '../../src/types/index.js';

describe('renderDeepLink', () => {
  it('timecode with youtube.com URL extracts video id and uses youtu.be form', () => {
    const loc: Locator = { kind: 'timecode', startSec: 65, endSec: 75 };
    const result = renderDeepLink('https://www.youtube.com/watch?v=ABC123', loc);
    expect(result).toBe('https://youtu.be/ABC123?t=65');
  });

  it('timecode with youtu.be URL extracts video id', () => {
    const loc: Locator = { kind: 'timecode', startSec: 10, endSec: 20 };
    const result = renderDeepLink('https://youtu.be/XYZ789', loc);
    expect(result).toBe('https://youtu.be/XYZ789?t=10');
  });

  it('timecode YouTube link does not carry over extra query params', () => {
    const loc: Locator = { kind: 'timecode', startSec: 5, endSec: 15 };
    const result = renderDeepLink('https://www.youtube.com/watch?v=ABC123&list=PLxxx&si=yyy', loc);
    expect(result).toBe('https://youtu.be/ABC123?t=5');
  });

  it('timecode with non-YouTube URL uses fragment form', () => {
    const loc: Locator = { kind: 'timecode', startSec: 30, endSec: 40 };
    const result = renderDeepLink('https://example.com/video.mp4', loc);
    expect(result).toBe('https://example.com/video.mp4#t=30');
  });

  it('timecode YouTube fallback when video id cannot be extracted', () => {
    const loc: Locator = { kind: 'timecode', startSec: 5, endSec: 10 };
    const result = renderDeepLink('https://www.youtube.com/channel/UCxxx', loc);
    expect(result).toBe('https://www.youtube.com/channel/UCxxx#t=5');
  });

  it('page produces #page= fragment', () => {
    const loc: Locator = { kind: 'page', page: 3, charStart: 0, charEnd: 50 };
    expect(renderDeepLink('https://example.com/doc.pdf', loc)).toBe('https://example.com/doc.pdf#page=3');
  });

  it('dom produces text fragment link', () => {
    const loc: Locator = { kind: 'dom', textFragment: 'hello world', charStart: 0, charEnd: 5 };
    expect(renderDeepLink('https://example.com/page', loc)).toBe(
      `https://example.com/page#:~:text=${encodeURIComponent('hello world')}`
    );
  });

  it('message produces #messageId fragment', () => {
    const loc: Locator = { kind: 'message', messageId: 'msg-123', charStart: 0, charEnd: 20 };
    expect(renderDeepLink('https://example.com/thread', loc)).toBe('https://example.com/thread#msg-123');
  });

  it('text returns resourceUri when non-empty', () => {
    const loc: Locator = { kind: 'text', charStart: 0, charEnd: 10 };
    expect(renderDeepLink('https://example.com/doc', loc)).toBe('https://example.com/doc');
  });

  it('text returns null when resourceUri is empty', () => {
    const loc: Locator = { kind: 'text', charStart: 0, charEnd: 10 };
    expect(renderDeepLink('', loc)).toBeNull();
  });

  it('external returns null', () => {
    const loc: Locator = { kind: 'external', system: 'jira', externalId: 'PROJ-42' };
    expect(renderDeepLink('https://example.com', loc)).toBeNull();
  });
});

describe('renderLabel', () => {
  it('timecode 0 seconds renders as 0:00', () => {
    const loc: Locator = { kind: 'timecode', startSec: 0, endSec: 10 };
    expect(renderLabel(loc)).toBe('0:00');
  });

  it('timecode 65 seconds renders as 1:05', () => {
    const loc: Locator = { kind: 'timecode', startSec: 65, endSec: 75 };
    expect(renderLabel(loc)).toBe('1:05');
  });

  it('timecode 3661 seconds renders as 1:01:01', () => {
    const loc: Locator = { kind: 'timecode', startSec: 3661, endSec: 3671 };
    expect(renderLabel(loc)).toBe('1:01:01');
  });

  it('page renders as p.<n>', () => {
    const loc: Locator = { kind: 'page', page: 7, charStart: 0, charEnd: 10 };
    expect(renderLabel(loc)).toBe('p.7');
  });

  it('dom truncates textFragment to 40 chars', () => {
    const loc: Locator = {
      kind: 'dom',
      textFragment: 'a'.repeat(50),
      charStart: 0,
      charEnd: 10,
    };
    expect(renderLabel(loc)).toBe('a'.repeat(40));
  });

  it('dom textFragment shorter than 40 chars is unchanged', () => {
    const loc: Locator = { kind: 'dom', textFragment: 'short text', charStart: 0, charEnd: 5 };
    expect(renderLabel(loc)).toBe('short text');
  });

  it('message renders as messageId', () => {
    const loc: Locator = { kind: 'message', messageId: 'msg-abc', charStart: 0, charEnd: 10 };
    expect(renderLabel(loc)).toBe('msg-abc');
  });

  it('text renders as empty string', () => {
    const loc: Locator = { kind: 'text', charStart: 0, charEnd: 10 };
    expect(renderLabel(loc)).toBe('');
  });

  it('external renders as "<system>: <externalId>"', () => {
    const loc: Locator = { kind: 'external', system: 'jira', externalId: 'PROJ-42' };
    expect(renderLabel(loc)).toBe('jira: PROJ-42');
  });

  it('is deterministic: same inputs produce same output', () => {
    const loc: Locator = { kind: 'timecode', startSec: 123, endSec: 133 };
    expect(renderLabel(loc)).toBe(renderLabel(loc));
  });
});
