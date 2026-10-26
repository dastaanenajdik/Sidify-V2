/**
 * A tiny in-memory token bucket.
 *
 * Purpose: the ticket endpoint signs upstream requests on demand, so it is the
 * one route where an unauthenticated caller could make this deployment hammer
 * the catalogue. A per-caller bucket keeps that bounded without a database.
 *
 * Honest limitations, on purpose:
 *   - it is per serverless instance, so a caller spread across 20 instances
 *     gets 20 buckets. That is still a large improvement over no limit, and it
 *     costs no round trip.
 *   - it is not a security control against a determined attacker; upstream
 *     rate limits are. It stops a runaway client (a retry loop, a shared link
 *     opened by hundreds of tabs) from turning into an upstream ban.
 */

export interface BucketState {
  tokens: number;
  updatedAt: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  /** Milliseconds until at least one token is available. */
  retryAfterMs: number;
}

export interface RateLimiterOptions {
  /** Bucket size: the maximum burst. */
  capacity: number;
  /** Tokens refilled per second. */
  refillPerSecond: number;
  /** Buckets kept at most; the oldest are dropped beyond this. */
  maxKeys?: number;
  now?: () => number;
}

export class TokenBucketLimiter {
  private readonly buckets = new Map<string, BucketState>();
  private readonly capacity: number;
  private readonly refillPerSecond: number;
  private readonly maxKeys: number;
  private readonly now: () => number;

  constructor(options: RateLimiterOptions) {
    this.capacity = Math.max(1, options.capacity);
    this.refillPerSecond = Math.max(0.01, options.refillPerSecond);
    this.maxKeys = Math.max(16, options.maxKeys ?? 5_000);
    this.now = options.now ?? Date.now;
  }

  /** Takes one token for `key`, refilling first. */
  take(key: string): RateLimitResult {
    const now = this.now();
    const bucket = this.buckets.get(key) ?? { tokens: this.capacity, updatedAt: now };

    const elapsedSeconds = Math.max(0, (now - bucket.updatedAt) / 1000);
    bucket.tokens = Math.min(this.capacity, bucket.tokens + elapsedSeconds * this.refillPerSecond);
    bucket.updatedAt = now;

    let allowed = false;
    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      allowed = true;
    }

    if (this.buckets.has(key)) this.buckets.delete(key);
    this.buckets.set(key, bucket);
    this.evict();

    return {
      allowed,
      remaining: Math.floor(bucket.tokens),
      retryAfterMs: allowed ? 0 : Math.ceil(((1 - bucket.tokens) / this.refillPerSecond) * 1000),
    };
  }

  /** Test seam. */
  reset(): void {
    this.buckets.clear();
  }

  get size(): number {
    return this.buckets.size;
  }

  private evict(): void {
    if (this.buckets.size <= this.maxKeys) return;
    const overflow = this.buckets.size - this.maxKeys;
    let removed = 0;
    for (const key of this.buckets.keys()) {
      this.buckets.delete(key);
      if (++removed >= overflow) break;
    }
  }
}

/**
 * The caller's identity for rate-limiting purposes.
 *
 * `x-forwarded-for` is only trusted because the deployment is behind a proxy
 * that sets it (Vercel does). Falls back to a constant so a header-less request
 * still gets a bucket instead of an unlimited pass.
 */
export function callerKey(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return headers.get("x-real-ip")?.trim() || headers.get("cf-connecting-ip")?.trim() || "unknown";
}
