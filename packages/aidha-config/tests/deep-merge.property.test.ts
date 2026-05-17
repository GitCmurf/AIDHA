// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 Colin Farmer (GitCmurf)

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { deepMerge } from '../src/resolver.js';

describe('deepMerge (property-based)', () => {
  it('should preserve properties of the target when not overridden', () => {
    const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
    fc.assert(
      fc.property(fc.dictionary(fc.string(), fc.anything()), fc.dictionary(fc.string(), fc.anything()), (target, source) => {
        const result = deepMerge(target as any, source as any);
        for (const key of Object.keys(target)) {
          if (!(key in source) && !UNSAFE_KEYS.has(key)) {
            expect(result[key]).toEqual(target[key]);
          }
        }
      })
    );
  });

  it('should let the source win for scalar values', () => {
    const scalar = fc.oneof(fc.string(), fc.integer(), fc.boolean(), fc.constant(null));
    const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
    fc.assert(
      fc.property(fc.dictionary(fc.string(), scalar), fc.dictionary(fc.string(), scalar), (target, source) => {
        const result = deepMerge(target as any, source as any);
        for (const key of Object.keys(source)) {
          if (!UNSAFE_KEYS.has(key)) {
            expect(result[key]).toEqual(source[key]);
          }
        }
      })
    );
  });

  it('should replace arrays instead of merging them', () => {
    fc.assert(
      fc.property(fc.array(fc.anything()), fc.array(fc.anything()), (targetArr, sourceArr) => {
        const target = { arr: targetArr };
        const source = { arr: sourceArr };
        const result = deepMerge(target, source as any);
        expect(result.arr).toBe(sourceArr);
        expect(result.arr).not.toBe(targetArr);
      })
    );
  });

  it('should protect against unsafe keys (__proto__, constructor, prototype)', () => {
    const target = { a: 1 };
    const source = {
      ['__proto__']: { polluted: true },
      ['constructor']: { polluted: true },
      ['prototype']: { polluted: true },
    };

    const result = deepMerge(target, source as any);

    expect(result).toEqual({ a: 1 });
    expect((result as any).polluted).toBeUndefined();
    expect((Object.prototype as any).polluted).toBeUndefined();
  });
});
