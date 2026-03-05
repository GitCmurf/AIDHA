/**
 * Circuit Breaker Tests
 *
 * Tests the circuit breaker state machine for resilient external service calls.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  CircuitBreaker,
  CircuitBreakerState,
  CircuitBreakerOpenError,
} from '../src/extract/circuit-breaker.js';

import type { CircuitBreakerConfig } from '../src/extract/circuit-breaker.js';

describe('circuit-breaker', () => {
  describe('initial state', () => {
    it('starts in CLOSED state', () => {
      const breaker = new CircuitBreaker();
      expect(breaker.getState()).toBe(CircuitBreakerState.Closed);
    });

    it('uses default configuration when not specified', () => {
      const breaker = new CircuitBreaker();
      expect(breaker.getState()).toBe(CircuitBreakerState.Closed);
    });

    it('allows custom configuration', () => {
      const config: Partial<CircuitBreakerConfig> = {
        failureThreshold: 3,
        resetTimeoutMs: 10000,
        halfOpenMaxCalls: 2,
      };
      const breaker = new CircuitBreaker(config);
      expect(breaker.getState()).toBe(CircuitBreakerState.Closed);
    });
  });

  describe('failure counting and transition to OPEN', () => {
    let breaker: CircuitBreaker;

    beforeEach(() => {
      breaker = new CircuitBreaker({ failureThreshold: 3 });
    });

    it('increments failure count on recordFailure', () => {
      breaker.recordFailure();
      const stats = breaker.getStats();
      expect(stats.failures).toBe(1);
    });

    it('stays CLOSED below failure threshold', () => {
      breaker.recordFailure();
      breaker.recordFailure();
      expect(breaker.getState()).toBe(CircuitBreakerState.Closed);
    });

    it('transitions to OPEN after reaching failure threshold', () => {
      breaker.recordFailure();
      breaker.recordFailure();
      breaker.recordFailure();
      expect(breaker.getState()).toBe(CircuitBreakerState.Open);
    });

    it('records last failure time', () => {
      const before = Date.now();
      breaker.recordFailure();
      const after = Date.now();
      const stats = breaker.getStats();

      expect(stats.lastFailureTime).not.toBeNull();
      expect(stats.lastFailureTime).toBeGreaterThanOrEqual(before);
      expect(stats.lastFailureTime).toBeLessThanOrEqual(after);
    });
  });

  describe('OPEN state behavior', () => {
    let breaker: CircuitBreaker;

    beforeEach(() => {
      breaker = new CircuitBreaker({
        failureThreshold: 2,
        resetTimeoutMs: 5000,
      });
      // Transition to OPEN state
      breaker.recordFailure();
      breaker.recordFailure();
      expect(breaker.getState()).toBe(CircuitBreakerState.Open);
    });

    it('rejects calls when in OPEN state', () => {
      expect(breaker.canExecute()).toBe(false);
    });

    it('throws CircuitBreakerOpenError when execute() called in OPEN state', async () => {
      await expect(breaker.execute(async () => 'success')).rejects.toThrow(
        CircuitBreakerOpenError
      );
    });

    it('includes remaining time in CircuitBreakerOpenError', async () => {
      try {
        await breaker.execute(async () => 'success');
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(CircuitBreakerOpenError);
        const openError = error as CircuitBreakerOpenError;
        expect(openError.remainingMs).toBeGreaterThan(0);
        expect(openError.remainingMs).toBeLessThanOrEqual(5000);
        expect(openError.message).toContain('Circuit breaker is OPEN');
      }
    });

    it('does not increment failure count when already OPEN', () => {
      const statsBefore = breaker.getStats();
      breaker.recordFailure();
      const statsAfter = breaker.getStats();

      expect(statsAfter.failures).toBe(statsBefore.failures);
    });
  });

  describe('transition to HALF_OPEN after timeout', () => {
    let breaker: CircuitBreaker;

    beforeEach(() => {
      breaker = new CircuitBreaker({
        failureThreshold: 2,
        resetTimeoutMs: 100,
      });
      // Transition to OPEN state
      breaker.recordFailure();
      breaker.recordFailure();
    });

    it('transitions to HALF_OPEN after reset timeout', async () => {
      expect(breaker.getState()).toBe(CircuitBreakerState.Open);

      // Wait for reset timeout
      await new Promise((resolve) => setTimeout(resolve, 150));

      // Calling getState triggers the transition check
      expect(breaker.getState()).toBe(CircuitBreakerState.HalfOpen);
    });

    it('canExecute triggers transition check', async () => {
      expect(breaker.getState()).toBe(CircuitBreakerState.Open);

      // Wait for reset timeout
      await new Promise((resolve) => setTimeout(resolve, 150));

      // Calling canExecute triggers the transition check
      expect(breaker.canExecute()).toBe(true);
      expect(breaker.getState()).toBe(CircuitBreakerState.HalfOpen);
    });
  });

  describe('HALF_OPEN state success transitions', () => {
    let breaker: CircuitBreaker;

    beforeEach(async () => {
      breaker = new CircuitBreaker({
        failureThreshold: 2,
        resetTimeoutMs: 50,
      });
      // Transition to OPEN then wait for HALF_OPEN
      breaker.recordFailure();
      breaker.recordFailure();
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(breaker.getState()).toBe(CircuitBreakerState.HalfOpen);
    });

    it('allows limited calls in HALF_OPEN state', () => {
      expect(breaker.canExecute()).toBe(true);
      // Simulate inflight calls reaching the limit
      (breaker as any).halfOpenCallCount = 3;
      expect(breaker.canExecute()).toBe(false);
    });

    it('transitions to CLOSED after success in HALF_OPEN', () => {
      breaker.recordSuccess();
      expect(breaker.getState()).toBe(CircuitBreakerState.Closed);
    });

    it('resets failure count after transitioning to CLOSED', () => {
      breaker.recordSuccess();
      const stats = breaker.getStats();
      expect(stats.failures).toBe(0);
      expect(stats.lastFailureTime).toBeNull();
    });

    it('tracks success count in HALF_OPEN state', () => {
      breaker.recordSuccess();
      const stats = breaker.getStats();
      expect(stats.successes).toBe(0); // Reset after transition to CLOSED
    });
  });

  describe('HALF_OPEN state failure returns to OPEN', () => {
    let breaker: CircuitBreaker;

    beforeEach(async () => {
      breaker = new CircuitBreaker({
        failureThreshold: 3,
        resetTimeoutMs: 50,
      });
      // Transition to OPEN
      breaker.recordFailure();
      breaker.recordFailure();
      breaker.recordFailure();
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(breaker.getState()).toBe(CircuitBreakerState.HalfOpen);
    });

    it('returns to OPEN on failure in HALF_OPEN', () => {
      breaker.recordFailure();
      expect(breaker.getState()).toBe(CircuitBreakerState.Open);
    });

    it('updates last failure time when returning to OPEN', async () => {
      const beforeFailure = Date.now();
      breaker.recordFailure();
      const stats = breaker.getStats();

      expect(stats.lastFailureTime).toBeGreaterThanOrEqual(beforeFailure);
    });
  });

  describe('execute() wrapper with async functions', () => {
    let breaker: CircuitBreaker;

    beforeEach(() => {
      breaker = new CircuitBreaker({
        failureThreshold: 3,
        resetTimeoutMs: 100,
      });
    });

    it('executes async function successfully', async () => {
      const result = await breaker.execute(async () => {
        return 'success';
      });
      expect(result).toBe('success');
    });

    it('records success when function resolves', async () => {
      await breaker.execute(async () => 'test');
      const stats = breaker.getStats();
      expect(stats.failures).toBe(0);
    });

    it('records failure when function rejects', async () => {
      await expect(
        breaker.execute(async () => {
          throw new Error('Test error');
        })
      ).rejects.toThrow('Test error');

      const stats = breaker.getStats();
      expect(stats.failures).toBe(1);
    });

    it('re-throws original error on failure', async () => {
      const customError = new Error('Custom error');
      await expect(
        breaker.execute(async () => {
          throw customError;
        })
      ).rejects.toBe(customError);
    });

    it('handles synchronous values returned from async function', async () => {
      const result = await breaker.execute(async () => 42);
      expect(result).toBe(42);
    });

    it('handles complex return types', async () => {
      const complex = { data: [1, 2, 3], nested: { value: true } };
      const result = await breaker.execute(async () => complex);
      expect(result).toEqual(complex);
    });

    it('transitions to OPEN after repeated async failures', async () => {
      for (let i = 0; i < 2; i++) {
        try {
          await breaker.execute(async () => {
            throw new Error('Fail');
          });
        } catch {
          // Expected
        }
      }

      expect(breaker.getState()).toBe(CircuitBreakerState.Closed);

      // Third failure triggers OPEN
      try {
        await breaker.execute(async () => {
          throw new Error('Fail');
        });
      } catch {
        // Expected
      }

      expect(breaker.getState()).toBe(CircuitBreakerState.Open);
    });

    it('allows recovery after timeout with successful execute()', async () => {
      // Transition to OPEN
      for (let i = 0; i < 3; i++) {
        try {
          await breaker.execute(async () => {
            throw new Error('Fail');
          });
        } catch {
          // Expected
        }
      }

      expect(breaker.getState()).toBe(CircuitBreakerState.Open);

      // Wait for timeout
      await new Promise((resolve) => setTimeout(resolve, 150));

      // Successful execute should transition to CLOSED
      const result = await breaker.execute(async () => 'recovered');
      expect(result).toBe('recovered');
      expect(breaker.getState()).toBe(CircuitBreakerState.Closed);
    });
  });

  describe('stats reporting', () => {
    let breaker: CircuitBreaker;

    beforeEach(() => {
      breaker = new CircuitBreaker({ failureThreshold: 5 });
    });

    it('reports initial stats correctly', () => {
      const stats = breaker.getStats();
      expect(stats.failures).toBe(0);
      expect(stats.successes).toBe(0);
      expect(stats.lastFailureTime).toBeNull();
    });

    it('updates failure count in stats', () => {
      breaker.recordFailure();
      breaker.recordFailure();
      const stats = breaker.getStats();
      expect(stats.failures).toBe(2);
    });

    it('records success and transitions to CLOSED from HALF_OPEN', async () => {
      breaker = new CircuitBreaker({
        failureThreshold: 2,
        resetTimeoutMs: 50,
      });
      breaker.recordFailure();
      breaker.recordFailure();

      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(breaker.getState()).toBe(CircuitBreakerState.HalfOpen);

      breaker.recordSuccess();

      // Should transition to CLOSED after success in HALF_OPEN
      expect(breaker.getState()).toBe(CircuitBreakerState.Closed);
      // Stats are reset after transition to CLOSED
      const stats = breaker.getStats();
      expect(stats.successes).toBe(0);
      expect(stats.failures).toBe(0);
    });

    it('tracks last failure time accurately', () => {
      const t1 = Date.now();
      breaker.recordFailure();
      const t2 = Date.now();

      const stats = breaker.getStats();
      expect(stats.lastFailureTime).toBeGreaterThanOrEqual(t1);
      expect(stats.lastFailureTime).toBeLessThanOrEqual(t2);
    });

    it('resets stats on success in CLOSED state', () => {
      breaker.recordFailure();
      breaker.recordFailure();
      breaker.recordFailure();
      breaker.recordSuccess();

      const stats = breaker.getStats();
      expect(stats.failures).toBe(0);
      expect(stats.lastFailureTime).toBeNull();
    });
  });

  describe('CLOSED state success behavior', () => {
    let breaker: CircuitBreaker;

    beforeEach(() => {
      breaker = new CircuitBreaker({ failureThreshold: 3 });
    });

    it('always allows execution in CLOSED state', () => {
      expect(breaker.canExecute()).toBe(true);
    });

    it('resets failure count on success in CLOSED state', () => {
      breaker.recordFailure();
      breaker.recordFailure();
      breaker.recordSuccess();

      const stats = breaker.getStats();
      expect(stats.failures).toBe(0);
    });

    it('maintains CLOSED state on success', () => {
      breaker.recordSuccess();
      expect(breaker.getState()).toBe(CircuitBreakerState.Closed);
    });
  });

  describe('edge cases', () => {
    it('handles very short reset timeouts', async () => {
      const breaker = new CircuitBreaker({
        failureThreshold: 1,
        resetTimeoutMs: 1,
      });
      breaker.recordFailure();
      expect(breaker.getState()).toBe(CircuitBreakerState.Open);

      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(breaker.canExecute()).toBe(true);
    });

    it('normalizes zero halfOpenMaxCalls to 1', async () => {
      const breaker = new CircuitBreaker({
        failureThreshold: 1,
        resetTimeoutMs: 50,
        halfOpenMaxCalls: 0,
      });
      breaker.recordFailure();

      await new Promise((resolve) => setTimeout(resolve, 100));
      // Normalized to 1, so first check is true
      expect(breaker.canExecute()).toBe(true);
      (breaker as any).halfOpenCallCount = 1;
      expect(breaker.canExecute()).toBe(false);
    });

    it('handles multiple execute() calls in succession', async () => {
      const breaker = new CircuitBreaker();

      const results = await Promise.all([
        breaker.execute(async () => 1),
        breaker.execute(async () => 2),
        breaker.execute(async () => 3),
      ]);

      expect(results).toEqual([1, 2, 3]);
    });

    it('handles execute() with delayed rejection', async () => {
      const breaker = new CircuitBreaker({ failureThreshold: 2 });

      await expect(
        breaker.execute(async () => {
          await new Promise((_, reject) => setTimeout(() => reject(new Error('Delayed')), 50));
          return 'never reached';
        })
      ).rejects.toThrow('Delayed');

      expect(breaker.getStats().failures).toBe(1);
    });

    it('handles execute() with delayed resolution', async () => {
      const breaker = new CircuitBreaker();

      const result = await breaker.execute(async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
        return 'delayed success';
      });

      expect(result).toBe('delayed success');
      expect(breaker.getStats().failures).toBe(0);
    });
  });
});
