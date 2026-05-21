// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 Colin Farmer (GitCmurf)

export enum CircuitBreakerState {
  Closed = 'closed',
  Open = 'open',
  HalfOpen = 'half-open',
}

export interface CircuitBreakerConfig {
  failureThreshold: number;
  resetTimeoutMs: number;
  halfOpenMaxCalls: number;
  halfOpenSuccessThreshold: number;
}

export interface CircuitBreakerStats {
  failures: number;
  successes: number;
  lastFailureTime: number | null;
}

export class CircuitBreakerOpenError extends Error {
  readonly remainingMs: number;

  constructor(remainingMs: number, message?: string) {
    super(message ?? `Circuit breaker is OPEN. Retry after ${remainingMs}ms`);
    this.name = 'CircuitBreakerOpenError';
    this.remainingMs = remainingMs;
  }
}

const DEFAULT_CONFIG: Required<CircuitBreakerConfig> = {
  failureThreshold: 5,
  resetTimeoutMs: 30000,
  halfOpenMaxCalls: 3,
  halfOpenSuccessThreshold: 1,
};

export class CircuitBreaker {
  private readonly config: Required<CircuitBreakerConfig>;
  private state: CircuitBreakerState = CircuitBreakerState.Closed;
  private failures = 0;
  private successes = 0;
  private lastFailureTime: number | null = null;
  private halfOpenCallCount = 0;

  constructor(config: Partial<CircuitBreakerConfig> = {}) {
    const halfOpenMaxCalls = Math.max(1, config.halfOpenMaxCalls ?? DEFAULT_CONFIG.halfOpenMaxCalls);
    // Clamp halfOpenSuccessThreshold to halfOpenMaxCalls to make HalfOpen recoverable
    const halfOpenSuccessThreshold = Math.max(
      1,
      Math.min(halfOpenMaxCalls, config.halfOpenSuccessThreshold ?? DEFAULT_CONFIG.halfOpenSuccessThreshold)
    );
    this.config = {
      failureThreshold: Math.max(1, config.failureThreshold ?? DEFAULT_CONFIG.failureThreshold),
      resetTimeoutMs: Math.max(1, config.resetTimeoutMs ?? DEFAULT_CONFIG.resetTimeoutMs),
      halfOpenMaxCalls,
      halfOpenSuccessThreshold,
    };
  }

  getState(): CircuitBreakerState {
    this.maybeTransitionFromOpen();
    return this.state;
  }

  getStats(): CircuitBreakerStats {
    return {
      failures: this.failures,
      successes: this.successes,
      lastFailureTime: this.lastFailureTime,
    };
  }

  recordSuccess(): void {
    switch (this.state) {
      case CircuitBreakerState.Closed: {
        this.failures = 0;
        this.lastFailureTime = null;
        break;
      }

      case CircuitBreakerState.HalfOpen: {
        this.successes++;
        this.failures = 0;

        if (this.successes >= this.config.halfOpenSuccessThreshold) {
          this.transitionToClosed();
        }
        break;
      }

      case CircuitBreakerState.Open: {
        // No-op: should not happen if callers check canExecute
        break;
      }
    }
  }

  recordFailure(): void {
    switch (this.state) {
      case CircuitBreakerState.Closed: {
        this.lastFailureTime = Date.now();
        this.failures++;

        if (this.failures >= this.config.failureThreshold) {
          this.transitionToOpen();
        }
        break;
      }

      case CircuitBreakerState.HalfOpen: {
        this.lastFailureTime = Date.now();
        this.transitionToOpen();
        break;
      }

      case CircuitBreakerState.Open: {
        // No-op: already in open state, don't push out recovery time
        break;
      }
    }
  }

  canExecute(): boolean {
    this.maybeTransitionFromOpen();

    switch (this.state) {
      case CircuitBreakerState.Closed: {
        return true;
      }

      case CircuitBreakerState.Open: {
        return false;
      }

      case CircuitBreakerState.HalfOpen: {
        return this.halfOpenCallCount < this.config.halfOpenMaxCalls;
      }
    }
  }

  incrementHalfOpenCallCount(): void {
    if (this.state === CircuitBreakerState.HalfOpen) {
      this.halfOpenCallCount++;
    }
  }

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    // Capture state before canExecute() (which may transition Open→HalfOpen)
    const stateBefore = this.state;
    if (!this.canExecute()) {
      if (stateBefore === CircuitBreakerState.HalfOpen) {
        throw new CircuitBreakerOpenError(
          0,
          'Circuit breaker is HALF_OPEN. Probe limit reached; wait for in-flight probe results.'
        );
      }
      const remaining = this.config.resetTimeoutMs - (Date.now() - (this.lastFailureTime ?? 0));
      throw new CircuitBreakerOpenError(Math.max(0, remaining));
    }

    const wasHalfOpen = this.state === CircuitBreakerState.HalfOpen;
    if (wasHalfOpen) {
      this.halfOpenCallCount++;
    }

    try {
      const result = await fn();
      this.recordSuccess();
      return result;
    } catch (error) {
      this.recordFailure();
      throw error;
    }
  }

  private maybeTransitionFromOpen(): void {
    if (this.state !== CircuitBreakerState.Open) {
      return;
    }

    if (this.lastFailureTime === null) {
      return;
    }

    const elapsed = Date.now() - this.lastFailureTime;
    if (elapsed >= this.config.resetTimeoutMs) {
      this.transitionToHalfOpen();
    }
  }

  private transitionToClosed(): void {
    this.state = CircuitBreakerState.Closed;
    this.failures = 0;
    this.successes = 0;
    this.halfOpenCallCount = 0;
    this.lastFailureTime = null;
  }

  private transitionToOpen(): void {
    this.state = CircuitBreakerState.Open;
    this.successes = 0;
    this.halfOpenCallCount = 0;
  }

  private transitionToHalfOpen(): void {
    this.state = CircuitBreakerState.HalfOpen;
    this.failures = 0;
    this.successes = 0;
    this.halfOpenCallCount = 0;
  }
}
