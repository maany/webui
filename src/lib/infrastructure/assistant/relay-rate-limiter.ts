export interface RateLimitDecision {
    allowed: boolean;
    retryAfterSeconds: number;
}

const PRUNE_THRESHOLD = 10_000;

/**
 * In-memory sliding window limiter. One instance per server process: with several replicas
 * each replica enforces the limit on its own.
 */
export class SlidingWindowRateLimiter {
    private readonly hits = new Map<string, number[]>();

    constructor(private readonly windowMs: number = 60_000, private readonly now: () => number = () => Date.now()) {}

    hit(key: string, limit: number): RateLimitDecision {
        const current = this.now();
        const windowStart = current - this.windowMs;
        const recent = (this.hits.get(key) ?? []).filter(time => time > windowStart);
        if (recent.length >= limit) {
            this.hits.set(key, recent);
            const retryAfterSeconds = Math.max(1, Math.ceil((recent[0] + this.windowMs - current) / 1000));
            return { allowed: false, retryAfterSeconds };
        }
        recent.push(current);
        this.hits.set(key, recent);
        if (this.hits.size > PRUNE_THRESHOLD) this.prune(windowStart);
        return { allowed: true, retryAfterSeconds: 0 };
    }

    reset(): void {
        this.hits.clear();
    }

    private prune(windowStart: number): void {
        Array.from(this.hits.entries()).forEach(([key, times]) => {
            if (times.every(time => time <= windowStart)) this.hits.delete(key);
        });
    }
}

/** Shared by every relay request in this server process. */
export const relayRateLimiter = new SlidingWindowRateLimiter();

/**
 * Per-session limiter for other same-origin relays (phase 6 telemetry relay).
 * check() records the request and returns false once the session made limitPerMinute requests in the last 60 s.
 */
export function createRelayRateLimiter(limitPerMinute: number): { check(sessionKey: string, now?: number): boolean } {
    let current = Date.now();
    const limiter = new SlidingWindowRateLimiter(60_000, () => current);
    return {
        check(sessionKey: string, now: number = Date.now()): boolean {
            current = now;
            return limiter.hit(sessionKey, limitPerMinute).allowed;
        },
    };
}
