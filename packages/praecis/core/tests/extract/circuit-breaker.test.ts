// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 Colin Farmer (GitCmurf)

import { describe, it, expect, vi } from 'vitest';
import { CircuitBreaker, CircuitBreakerState } from '../../src/extract/circuit-breaker.js';

describe('CircuitBreaker', () => {
  it('starts in closed state', () => {
    expect(new CircuitBreaker({}).getState()).toBe(CircuitBreakerState.Closed);
  });

  it('opens after threshold consecutive failures', async () => {
    const cb = new CircuitBreaker({ failureThreshold: 3 });
    for (let i = 0; i < 3; i++) {
      try { await cb.execute(async () => { throw new Error('fail'); }); } catch { /* expected */ }
    }
    expect(cb.getState()).toBe(CircuitBreakerState.Open);
  });

  it('rejects immediately when open without calling fn', async () => {
    const cb = new CircuitBreaker({ failureThreshold: 1 });
    const fn = vi.fn(async () => { throw new Error('fail'); });
    try { await cb.execute(fn); } catch { /* */ }
    const callsBefore = fn.mock.calls.length;
    await expect(cb.execute(fn)).rejects.toThrow();
    expect(fn.mock.calls.length).toBe(callsBefore);
  });

  it('resets failure count on success', async () => {
    const cb = new CircuitBreaker({ failureThreshold: 3 });
    try { await cb.execute(async () => { throw new Error(); }); } catch { /* */ }
    await cb.execute(async () => 'ok');
    expect(cb.getState()).toBe(CircuitBreakerState.Closed);
  });
});
