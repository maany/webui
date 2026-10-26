import { createRelayRateLimiter, SlidingWindowRateLimiter } from '@/lib/infrastructure/assistant/relay-rate-limiter';

describe('SlidingWindowRateLimiter', () => {
    let now = 0;
    const limiter = () => new SlidingWindowRateLimiter(60_000, () => now);

    beforeEach(() => {
        now = 1_000_000;
    });

    it('allows up to the limit within the window', () => {
        const l = limiter();
        expect(l.hit('a', 2)).toEqual({ allowed: true, retryAfterSeconds: 0 });
        expect(l.hit('a', 2).allowed).toBe(true);
        expect(l.hit('a', 2)).toEqual({ allowed: false, retryAfterSeconds: 60 });
    });

    it('counts keys separately', () => {
        const l = limiter();
        l.hit('a', 1);
        expect(l.hit('a', 1).allowed).toBe(false);
        expect(l.hit('b', 1).allowed).toBe(true);
    });

    it('frees a slot once the oldest hit leaves the window', () => {
        const l = limiter();
        l.hit('a', 1);
        now += 59_000;
        expect(l.hit('a', 1)).toEqual({ allowed: false, retryAfterSeconds: 1 });
        now += 1_001;
        expect(l.hit('a', 1).allowed).toBe(true);
    });

    it('does not count rejected requests', () => {
        const l = limiter();
        l.hit('a', 1);
        l.hit('a', 1);
        l.hit('a', 1);
        now += 60_001;
        expect(l.hit('a', 1).allowed).toBe(true);
    });

    it('forgets everything on reset', () => {
        const l = limiter();
        l.hit('a', 1);
        l.reset();
        expect(l.hit('a', 1).allowed).toBe(true);
    });
});

describe('createRelayRateLimiter', () => {
    it('allows limitPerMinute checks per session key in any 60 s window', () => {
        const limiter = createRelayRateLimiter(2);
        expect(limiter.check('s1', 0)).toBe(true);
        expect(limiter.check('s1', 1_000)).toBe(true);
        expect(limiter.check('s1', 2_000)).toBe(false);
        expect(limiter.check('s2', 2_000)).toBe(true);
        expect(limiter.check('s1', 60_001)).toBe(true);
    });

    it('uses the current time when none is given', () => {
        const limiter = createRelayRateLimiter(1);
        expect(limiter.check('s1')).toBe(true);
        expect(limiter.check('s1')).toBe(false);
    });
});
