import { describe, it, expect } from 'vitest';
import { classifyRateLimit } from '../conversations';

describe('classifyRateLimit', () => {
    it('flags rate-limit errors and parses retry-after seconds', () => {
        expect(classifyRateLimit(new Error('API Error: 429 Too Many Requests; retry after 12s')))
            .toEqual({ isRateLimit: true, retryAfterMs: 12_000 });
        expect(classifyRateLimit(new Error('rate_limit_exceeded; retry-after: 5 seconds')))
            .toEqual({ isRateLimit: true, retryAfterMs: 5_000 });
        expect(classifyRateLimit(new Error('Overloaded; try again in 3 seconds')))
            .toEqual({ isRateLimit: true, retryAfterMs: 3_000 });
    });

    it('flags rate-limit errors without parseable retry-after', () => {
        expect(classifyRateLimit(new Error('Overloaded')))
            .toEqual({ isRateLimit: true, retryAfterMs: undefined });
        expect(classifyRateLimit(new Error('rate limit reached')))
            .toEqual({ isRateLimit: true, retryAfterMs: undefined });
    });

    it('does not flag unrelated errors', () => {
        expect(classifyRateLimit(new Error('ENOENT: no such file'))).toEqual({ isRateLimit: false });
        expect(classifyRateLimit(new Error('claude exited with code 1'))).toEqual({ isRateLimit: false });
        expect(classifyRateLimit('boom')).toEqual({ isRateLimit: false });
        expect(classifyRateLimit(null)).toEqual({ isRateLimit: false });
    });
});
