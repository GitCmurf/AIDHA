// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 Colin Farmer (GitCmurf)

import { describe, it, expect } from 'vitest';
import type { Locator } from '../../src/types/index.js';

describe('Locator', () => {
  it('timecode kind has startSec and endSec', () => {
    const loc: Locator = { kind: 'timecode', startSec: 0, endSec: 10 };
    expect(loc.kind).toBe('timecode');
    expect((loc as Extract<Locator, { kind: 'timecode' }>).startSec).toBe(0);
    expect((loc as Extract<Locator, { kind: 'timecode' }>).endSec).toBe(10);
  });

  it('timecode kind supports optional speaker', () => {
    const loc: Locator = { kind: 'timecode', startSec: 5, endSec: 15, speaker: 'Alice' };
    expect((loc as Extract<Locator, { kind: 'timecode' }>).speaker).toBe('Alice');
  });

  it('page kind is distinguishable by kind field', () => {
    const loc: Locator = { kind: 'page', page: 3, charStart: 0, charEnd: 50 };
    expect(loc.kind).toBe('page');
  });

  it('dom kind is distinguishable by kind field', () => {
    const loc: Locator = { kind: 'dom', textFragment: 'hello world', charStart: 0, charEnd: 5 };
    expect(loc.kind).toBe('dom');
  });

  it('message kind is distinguishable by kind field', () => {
    const loc: Locator = { kind: 'message', messageId: 'msg-123', charStart: 0, charEnd: 20 };
    expect(loc.kind).toBe('message');
  });

  it('text kind is distinguishable by kind field', () => {
    const loc: Locator = { kind: 'text', charStart: 10, charEnd: 30 };
    expect(loc.kind).toBe('text');
  });

  it('external kind is distinguishable by kind field', () => {
    const loc: Locator = { kind: 'external', system: 'jira', externalId: 'PROJ-42' };
    expect(loc.kind).toBe('external');
  });

  it('all 6 kinds are distinguishable at runtime', () => {
    const locators: Locator[] = [
      { kind: 'timecode', startSec: 0, endSec: 1 },
      { kind: 'page', page: 1, charStart: 0, charEnd: 10 },
      { kind: 'dom', textFragment: 'text', charStart: 0, charEnd: 4 },
      { kind: 'message', messageId: 'id', charStart: 0, charEnd: 2 },
      { kind: 'text', charStart: 0, charEnd: 5 },
      { kind: 'external', system: 'sys', externalId: 'ext-1' },
    ];
    const kinds = locators.map((l) => l.kind);
    expect(new Set(kinds).size).toBe(6);
  });
});
