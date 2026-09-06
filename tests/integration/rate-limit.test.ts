import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { checkRateLimit } from "@/lib/rate-limit";

// Pure in-memory logic — no DB needed. Each test uses its own unique keys
// so state from one test can't leak into another (the module keeps one
// process-wide Map, on purpose — see lib/rate-limit.ts).
describe("checkRateLimit", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("allows up to `max` requests in the window, then rejects with a retry-after", () => {
    const key = "test:basic";
    const opts = { max: 3, windowMs: 60_000 };

    expect(checkRateLimit(key, opts).allowed).toBe(true);
    expect(checkRateLimit(key, opts).allowed).toBe(true);
    expect(checkRateLimit(key, opts).allowed).toBe(true);

    const blocked = checkRateLimit(key, opts);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("resets once the window has fully elapsed", () => {
    const key = "test:window-reset";
    const opts = { max: 1, windowMs: 10_000 };

    expect(checkRateLimit(key, opts).allowed).toBe(true);
    expect(checkRateLimit(key, opts).allowed).toBe(false);

    vi.setSystemTime(new Date(Date.now() + 11_000)); // past the 10s window
    expect(checkRateLimit(key, opts).allowed).toBe(true);
  });

  it("trips independently per key — the same limit applied to a different key (e.g. a different IP or a per-student backoff key) is unaffected", () => {
    const opts = { max: 1, windowMs: 60_000 };
    const ipA = "student-login:203.0.113.1";
    const ipB = "student-login:203.0.113.2";

    expect(checkRateLimit(ipA, opts).allowed).toBe(true);
    expect(checkRateLimit(ipA, opts).allowed).toBe(false); // ipA is now limited...

    // ...but ipB, using the exact same options, is completely untouched.
    expect(checkRateLimit(ipB, opts).allowed).toBe(true);
  });
});
