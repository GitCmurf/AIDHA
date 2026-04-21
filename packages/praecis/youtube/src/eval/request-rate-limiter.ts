import type { LlmClient, LlmCompletionRequest } from "../extract/llm-client.js";
import type { Result } from "../pipeline/types.js";

interface LimiterState {
  windowStartMs: number;
  requestsInWindow: number;
}

export interface RateLimitStats {
  requests: number;
  waitMs: number;
}

const ONE_MINUTE_MS = 60_000;

class RequestRateLimiterRegistry {
  private readonly states = new Map<string, LimiterState>();
  private readonly stats = new Map<string, RateLimitStats>();

  async waitForSlot(key: string, rpm: number): Promise<number> {
    if (!Number.isFinite(rpm) || rpm <= 0) return 0;

    const now = Date.now();
    const state = this.states.get(key);
    if (!state || now - state.windowStartMs >= ONE_MINUTE_MS) {
      this.states.set(key, { windowStartMs: now, requestsInWindow: 1 });
      this.bumpRequests(key);
      return 0;
    }

    if (state.requestsInWindow < rpm) {
      state.requestsInWindow += 1;
      this.bumpRequests(key);
      return 0;
    }

    const waitMs = Math.max(0, ONE_MINUTE_MS - (now - state.windowStartMs));
    this.bumpWait(key, waitMs);
    await new Promise((resolve) => setTimeout(resolve, waitMs));
    const resumedAt = Date.now();
    this.states.set(key, { windowStartMs: resumedAt, requestsInWindow: 1 });
    this.bumpRequests(key);
    return waitMs;
  }

  getStats(): Record<string, RateLimitStats> {
    return Object.fromEntries(
      [...this.stats.entries()].map(([key, value]) => [key, { ...value }])
    );
  }

  reset(): void {
    this.states.clear();
    this.stats.clear();
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
  rpm: number
): LlmClient {
  return {
    async generate(request: LlmCompletionRequest): Promise<Result<string>> {
      const waitMs = await requestRateLimiterRegistry.waitForSlot(key, rpm);
      if (waitMs > 0) {
        console.log(`[rate-limit-wait] model=${key} waitMs=${waitMs}`);
      }
      return client.generate(request);
    },
  };
}
