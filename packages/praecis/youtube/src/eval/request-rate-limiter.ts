import type { LlmClient, LlmCompletionRequest } from "../extract/llm-client.js";
import type { Result } from "../pipeline/types.js";
import { consoleLogger, type Logger } from "../utils/logger.js";

interface LimiterState {
  windowStartMs: number;
  requestsInWindow: number;
}

export interface RateLimitStats {
  requests: number;
  waitMs: number;
}

const ONE_MINUTE_MS = 60_000;

export class RequestRateLimiterRegistry {
  private readonly states = new Map<string, LimiterState>();
  private readonly stats = new Map<string, RateLimitStats>();
  private readonly locks = new Map<string, Promise<void>>();

  private async withKeyLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(key) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });

    const chain = previous.then(() => current);
    this.locks.set(key, chain);
    await previous;

    try {
      return await fn();
    } finally {
      release();
      // Remove the entry when this was the last queued operation, so the
      // chain doesn't accumulate indefinitely in long-running processes.
      if (this.locks.get(key) === chain) {
        this.locks.delete(key);
      }
    }
  }

  async waitForSlot(key: string, rpm: number): Promise<number> {
    if (!Number.isFinite(rpm) || rpm <= 0) return 0;

    let totalWaitMs = 0;

    while (true) {
      const result = await this.withKeyLock(key, async () => {
        const now = Date.now();
        const state = this.states.get(key);
        if (!state || now - state.windowStartMs >= ONE_MINUTE_MS) {
          this.states.set(key, { windowStartMs: now, requestsInWindow: 1 });
          this.bumpRequests(key);
          return { granted: true, waitMs: 0 };
        }

        if (state.requestsInWindow < rpm) {
          state.requestsInWindow += 1;
          this.bumpRequests(key);
          return { granted: true, waitMs: 0 };
        }

        const waitMs = Math.max(0, ONE_MINUTE_MS - (now - state.windowStartMs));
        this.bumpWait(key, waitMs);
        return { granted: false, waitMs };
      });

      if (result.granted) {
        return totalWaitMs;
      }

      await new Promise((resolve) => setTimeout(resolve, result.waitMs));
      totalWaitMs += result.waitMs;
      // After sleeping, re-check the quota because other callers may have
      // consumed the slot while we were waiting.
    }
  }

  getStats(): Record<string, RateLimitStats> {
    return Object.fromEntries(
      [...this.stats.entries()].map(([key, value]) => [key, { ...value }])
    );
  }

  reset(): void {
    this.states.clear();
    this.stats.clear();
    this.locks.clear();
  }

  private bumpRequests(key: string): void {
    const current = this.stats.get(key) ?? { requests: 0, waitMs: 0 };
    current.requests += 1;
    this.stats.set(key, current);
  }

  private bumpWait(key: string, waitMs: number): void {
    const current = this.stats.get(key) ?? { requests: 0, waitMs: 0 };
    current.waitMs += waitMs;
    this.stats.set(key, current);
  }
}

export const requestRateLimiterRegistry = new RequestRateLimiterRegistry();

export function wrapClientWithRateLimit(
  client: LlmClient,
  key: string,
  rpm: number,
  logger: Logger = consoleLogger,
  registry: RequestRateLimiterRegistry = requestRateLimiterRegistry
): LlmClient {
  return {
    async generate(request: LlmCompletionRequest): Promise<Result<string>> {
      const waitMs = await registry.waitForSlot(key, rpm);
      if (waitMs > 0) {
        logger.info(`[rate-limit-wait] model=${key} waitMs=${waitMs}`);
      }
      return client.generate(request);
    },
  };
}
