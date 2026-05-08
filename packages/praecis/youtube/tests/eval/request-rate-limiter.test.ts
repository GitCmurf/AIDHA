import { afterEach, describe, expect, it, vi } from "vitest";
import { requestRateLimiterRegistry } from "../../src/eval/request-rate-limiter.js";

describe("RequestRateLimiterRegistry", () => {
  afterEach(() => {
    requestRateLimiterRegistry.reset();
    vi.useRealTimers();
  });

  it("queues and releases callers according to RPM limit using fake timers", async () => {
    vi.useFakeTimers();
    const rpm = 2; // 2 requests per minute

    // First two requests should resolve immediately
    const wait1 = requestRateLimiterRegistry.waitForSlot("test-model", rpm);
    const wait2 = requestRateLimiterRegistry.waitForSlot("test-model", rpm);

    expect(await wait1).toBe(0);
    expect(await wait2).toBe(0);

    // Third request should wait for the next window (60s)
    const wait3Promise = requestRateLimiterRegistry.waitForSlot("test-model", rpm);

    // Still waiting...
    await vi.advanceTimersByTimeAsync(30000);

    // Advance to 61s
    await vi.advanceTimersByTimeAsync(31000);

    const wait3 = await wait3Promise;
    expect(wait3).toBeGreaterThan(0);

    const stats = requestRateLimiterRegistry.getStats()["test-model"];
    expect(stats?.requests).toBe(3);
    expect(stats?.waitMs).toBeGreaterThan(0);
  });

  it("handles high concurrency without losing promises or corrupting stats", async () => {
    vi.useFakeTimers();
    const rpm = 10;
    const requestCount = 25;

    const promises = Array.from({ length: requestCount }, () =>
      requestRateLimiterRegistry.waitForSlot("concurrent-model", rpm)
    );

    // Run timers repeatedly until all promises resolve
    // We expect 10 immediately, 10 after 60s, 5 after 120s
    await vi.runAllTimersAsync();

    const results = await Promise.all(promises);
    expect(results).toHaveLength(requestCount);

    const stats = requestRateLimiterRegistry.getStats()["concurrent-model"];
    expect(stats?.requests).toBe(requestCount);
  });

  it("staggers multiple callers waiting for the same next window (bug fix)", async () => {
    vi.useFakeTimers();
    const rpm = 1; // 1 request per minute

    // First request resolves immediately
    expect(await requestRateLimiterRegistry.waitForSlot("stagger-test", rpm)).toBe(0);

    // Second and third requests both queue for the NEXT minute
    const wait2Promise = requestRateLimiterRegistry.waitForSlot("stagger-test", rpm);
    const wait3Promise = requestRateLimiterRegistry.waitForSlot("stagger-test", rpm);

    // Advance 61s
    await vi.advanceTimersByTimeAsync(61000);

    // Second should resolve, but third should STILL be waiting (it needs to wait another 60s)
    await Promise.resolve(); // Allow microtasks (the recursive call) to settle

    // We can't easily check if a promise is NOT resolved without a timeout,
    // but we can check if it resolves AFTER more time.
    let wait3Resolved = false;
    wait3Promise.then(() => { wait3Resolved = true; });

    const wait2 = await wait2Promise;
    expect(wait2).toBeGreaterThan(0);
    expect(wait3Resolved).toBe(false); // Should not have resolved yet!

    // Advance another 60s
    await vi.advanceTimersByTimeAsync(60000);
    const wait3 = await wait3Promise;
    expect(wait3).toBeGreaterThan(wait2);
    expect(wait3Resolved).toBe(true);
  });
});
