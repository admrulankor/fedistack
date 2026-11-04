export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: Date;
  retryAfterSeconds: number;
}

export interface RateLimiterOptions {
  windowMs: number;
  maxRequests: number;
}

export class SlidingWindowRateLimiter {
  private readonly windowMs: number;
  private readonly maxRequests: number;
  private readonly hits = new Map<string, number[]>();

  constructor(options: RateLimiterOptions) {
    if (options.windowMs <= 0 || options.maxRequests <= 0) {
      throw new Error(
        "RateLimiter windowMs and maxRequests must be positive integers."
      );
    }
    this.windowMs = options.windowMs;
    this.maxRequests = options.maxRequests;
  }

  public consume(key: string, nowMs: number = Date.now()): RateLimitResult {
    const windowStart = nowMs - this.windowMs;
    const existing = this.hits.get(key) ?? [];
    const activeTimestamps = existing.filter((ts) => ts > windowStart);

    if (activeTimestamps.length >= this.maxRequests) {
      this.hits.set(key, activeTimestamps);
      const oldestTimestamp = activeTimestamps[0] ?? nowMs;
      const resetAtMs = oldestTimestamp + this.windowMs;
      const retryAfterSeconds = Math.max(
        1,
        Math.ceil((resetAtMs - nowMs) / 1000)
      );

      return {
        allowed: false,
        remaining: 0,
        resetAt: new Date(resetAtMs),
        retryAfterSeconds
      };
    }

    activeTimestamps.push(nowMs);
    this.hits.set(key, activeTimestamps);

    const oldestTimestamp = activeTimestamps[0] ?? nowMs;
    const resetAtMs = oldestTimestamp + this.windowMs;

    return {
      allowed: true,
      remaining: Math.max(0, this.maxRequests - activeTimestamps.length),
      resetAt: new Date(resetAtMs),
      retryAfterSeconds: 0
    };
  }

  public reset(key?: string): void {
    if (key !== undefined) {
      this.hits.delete(key);
    } else {
      this.hits.clear();
    }
  }
}
