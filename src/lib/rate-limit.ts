/**
 * In-memory sliding-window rate limiter (per process).
 * For multi-instance deployments put a shared limiter (Redis / reverse proxy) in front - see docs/DEPLOYMENT.md.
 */
interface Bucket { hits: number[] }
const buckets = new Map<string, Bucket>();
let lastSweep = Date.now();

export function rateLimit(key: string, max: number, windowMs: number, now = Date.now()): { ok: boolean; retryAfterSec: number; remaining: number } {
  if (now - lastSweep > 60_000) {
    lastSweep = now;
    for (const [k, b] of buckets) {
      if (!b.hits.length || now - b.hits[b.hits.length - 1] > 15 * 60_000) buckets.delete(k);
    }
  }
  const b = buckets.get(key) ?? { hits: [] };
  const cutoff = now - windowMs;
  while (b.hits.length && b.hits[0] <= cutoff) b.hits.shift();
  if (b.hits.length >= max) {
    buckets.set(key, b);
    return { ok: false, retryAfterSec: Math.max(1, Math.ceil((b.hits[0] + windowMs - now) / 1000)), remaining: 0 };
  }
  b.hits.push(now);
  buckets.set(key, b);
  return { ok: true, retryAfterSec: 0, remaining: max - b.hits.length };
}

export function resetRateLimits() {
  buckets.clear();
}
