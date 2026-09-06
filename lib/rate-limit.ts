type Bucket = { count: number; windowStart: number };

const buckets = new Map<string, Bucket>();

export type RateLimitResult = { allowed: boolean; retryAfterSeconds: number };

/**
 * A simple in-memory fixed-window rate limiter, keyed by an arbitrary
 * string (e.g. `student-login:<ip>`). Deliberately not persisted to
 * Postgres — this is ephemeral security bookkeeping, not a business
 * record, and has no need for invariant-4-style durability or an audit
 * trail. In-memory and per-process: correct at this app's current
 * single-instance scale; a horizontally-scaled deployment would need a
 * shared store (Redis, etc.) instead, since each instance would otherwise
 * count independently and the limit would effectively multiply by however
 * many instances are running.
 *
 * Independent per key — this is what makes an IP-based limit (throttling
 * code enumeration across *different* student accounts) a genuinely
 * separate mechanism from lib/student-auth.ts's per-student backoff
 * (throttling repeated wrong guesses against *one* account): they're just
 * two different callers using two different key namespaces on the same
 * primitive, and each key's bucket only ever affects requests using that
 * exact key.
 */
export function checkRateLimit(key: string, opts: { max: number; windowMs: number }): RateLimitResult {
  const now = Date.now();
  const bucket = buckets.get(key);

  if (!bucket || now - bucket.windowStart >= opts.windowMs) {
    buckets.set(key, { count: 1, windowStart: now });
    return { allowed: true, retryAfterSeconds: 0 };
  }
  if (bucket.count >= opts.max) {
    return { allowed: false, retryAfterSeconds: Math.ceil((bucket.windowStart + opts.windowMs - now) / 1000) };
  }
  bucket.count++;
  return { allowed: true, retryAfterSeconds: 0 };
}
