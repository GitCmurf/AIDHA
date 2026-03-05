/**
 * Circuit breaker state machine for resilient external service calls.
 *
 * The circuit breaker pattern prevents cascade failures by monitoring
 * failure rates and temporarily blocking calls when a service appears
 * to be struggling. It provides automatic recovery testing through the
 * half-open state.
 */

/**
 * The three states of a circuit breaker.
 *
 * - `closed`: Normal operation, calls pass through and failures are counted.
 * - `open`: Circuit is tripped, calls fail immediately without executing.
 * - `half-open`: Recovery testing state, limited calls allowed to test if service recovered.
 */
export enum CircuitBreakerState {
  Closed = 'closed',
  Open = 'open',
  HalfOpen = 'half-open',
}

/**
 * Configuration options for the circuit breaker.
 */
export interface CircuitBreakerConfig {
  /**
   * Number of consecutive failures before transitioning to OPEN state.
   * @default 5
   */
  failureThreshold: number;

  /**
   * Time in milliseconds to wait before attempting recovery (transitioning to HALF_OPEN).
   * @default 30000
   */
  resetTimeoutMs: number;

  /**
   * Maximum number of calls allowed in HALF_OPEN state before deciding on state transition.
   * @default 3
   */
  halfOpenMaxCalls: number;

  /**
   * Number of consecutive successes required in HALF_OPEN state to transition to CLOSED.
   * @default 1
   */
  halfOpenSuccessThreshold: number;
}

/**
 * Runtime statistics for the circuit breaker.
 */
export interface CircuitBreakerStats {
  /** Number of consecutive failures since last success or state reset. */
  failures: number;

  /** Number of consecutive successes (relevant in half-open state). */
  successes: number;

  /** Timestamp of the last failure, or null if no failures recorded. */
  lastFailureTime: number | null;
}

/**
 * Error thrown when the circuit breaker is OPEN and blocks execution.
 */
export class CircuitBreakerOpenError extends Error {
  /**
   * Time in milliseconds until the circuit will attempt recovery.
   */
  readonly remainingMs: number;

  constructor(remainingMs: number) {
    super(`Circuit breaker is OPEN. Retry after ${remainingMs}ms`);
    this.name = 'CircuitBreakerOpenError';
    this.remainingMs = remainingMs;
  }
}

/**
 * Default configuration values.
 */
const DEFAULT_CONFIG: Required<CircuitBreakerConfig> = {
  failureThreshold: 5,
  resetTimeoutMs: 30000,
  halfOpenMaxCalls: 3,
  halfOpenSuccessThreshold: 1,
};

/**
 * Circuit breaker implementation using a state machine pattern.
 *
 * @example
 * ```typescript
 * const breaker = new CircuitBreaker({
 *   failureThreshold: 3,
 *   resetTimeoutMs: 10000,
 *   halfOpenMaxCalls: 2,
 * });
 *
 * const result = await breaker.execute(() => fetchData());
 * ```
 */
export class CircuitBreaker {
  private readonly config: Required<CircuitBreakerConfig>;
  private state: CircuitBreakerState = CircuitBreakerState.Closed;
  private failures = 0;
  private successes = 0;
  private lastFailureTime: number | null = null;
  private halfOpenCallCount = 0;

  /**
   * Creates a new CircuitBreaker instance.
   *
   * @param config - Partial configuration. Unspecified values use defaults.
   */
  constructor(config: Partial<CircuitBreakerConfig> = {}) {
    this.config = {
      failureThreshold: Math.max(1, config.failureThreshold ?? DEFAULT_CONFIG.failureThreshold),
      resetTimeoutMs: Math.max(1, config.resetTimeoutMs ?? DEFAULT_CONFIG.resetTimeoutMs),
      halfOpenMaxCalls: Math.max(1, config.halfOpenMaxCalls ?? DEFAULT_CONFIG.halfOpenMaxCalls),
      halfOpenSuccessThreshold: Math.max(1, config.halfOpenSuccessThreshold ?? DEFAULT_CONFIG.halfOpenSuccessThreshold),
    };
  }

  /**
   * Returns the current state of the circuit breaker.
   *
   * @returns The current {@link CircuitBreakerState}.
   */
  getState(): CircuitBreakerState {
    this.maybeTransitionFromOpen();
    return this.state;
  }

  /**
   * Returns runtime statistics for monitoring and debugging.
   *
   * @returns Current {@link CircuitBreakerStats}.
   */
  getStats(): CircuitBreakerStats {
    return {
      failures: this.failures,
      successes: this.successes,
      lastFailureTime: this.lastFailureTime,
    };
  }

  /**
   * Records a successful execution. Updates state based on current state:
   *
   * - Closed: Resets failure count to 0.
   * - Half-open: Increments success count; transitions to CLOSED if threshold met.
   * - Open: No-op (should not occur - callers should check canExecute first).
   */
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

  /**
   * Records a failed execution. Updates state based on current state:
   *
   * - Closed: Increments failure count; transitions to OPEN if threshold met.
   * - Half-open: Immediately transitions back to OPEN.
   * - Open: No-op (already failing).
   */
  recordFailure(): void {
    this.lastFailureTime = Date.now();

    switch (this.state) {
      case CircuitBreakerState.Closed: {
        this.failures++;

        if (this.failures >= this.config.failureThreshold) {
          this.transitionToOpen();
        }
        break;
      }

      case CircuitBreakerState.HalfOpen: {
        this.transitionToOpen();
        break;
      }

      case CircuitBreakerState.Open: {
        // No-op: already in open state
        break;
      }
    }
  }

  /**
   * Determines whether execution should be allowed based on current state.
   *
   * - Closed: Always allows execution.
   * - Open: Allows if reset timeout has elapsed (auto-transitions to half-open).
   * - Half-open: Allows if under the max calls limit.
   *
   * @returns `true` if execution is permitted, `false` otherwise.
   */
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

  /**
   * Executes an async function with circuit breaker protection.
   *
   * If the circuit is OPEN, throws {@link CircuitBreakerOpenError}.
   * Otherwise, executes the function and records success or failure.
   *
   * @param fn - Async function to execute.
   * @returns Promise resolving to the function's return value.
   * @throws {@link CircuitBreakerOpenError} if circuit is open.
   * @throws Any error thrown by `fn`.
   *
   * @example
   * ```typescript
   * const data = await breaker.execute(async () => {
   *   const response = await fetch(url);
   *   if (!response.ok) throw new Error('Failed');
   *   return response.json();
   * });
   * ```
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (!this.canExecute()) {
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

  /**
   * Checks if enough time has passed to transition from OPEN to HALF_OPEN.
   * Called automatically by state-checking methods.
   */
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

  /**
   * Transitions to CLOSED state and resets counters.
   */
  private transitionToClosed(): void {
    this.state = CircuitBreakerState.Closed;
    this.failures = 0;
    this.successes = 0;
    this.halfOpenCallCount = 0;
    this.lastFailureTime = null;
  }

  /**
   * Transitions to OPEN state.
   */
  private transitionToOpen(): void {
    this.state = CircuitBreakerState.Open;
    this.successes = 0;
    this.halfOpenCallCount = 0;
  }

  /**
   * Transitions to HALF_OPEN state for recovery testing.
   */
  private transitionToHalfOpen(): void {
    this.state = CircuitBreakerState.HalfOpen;
    this.failures = 0;
    this.successes = 0;
    this.halfOpenCallCount = 0;
  }
}
