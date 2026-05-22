import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

describe('config env overrides', () => {
    const original = process.env.CONCERTO_RECONCILE_INTERVAL_MS;

    beforeEach(() => {
        vi.resetModules();
        delete process.env.CONCERTO_RECONCILE_INTERVAL_MS;
    });

    afterEach(() => {
        if (original === undefined) delete process.env.CONCERTO_RECONCILE_INTERVAL_MS;
        else process.env.CONCERTO_RECONCILE_INTERVAL_MS = original;
    });

    it('falls back to the default when the env var is unset', async () => {
        const config = await import('../config');
        expect(config.RECONCILE_INTERVAL_MS).toBe(30_000);
    });

    it('honors the override via CONCERTO_RECONCILE_INTERVAL_MS', async () => {
        process.env.CONCERTO_RECONCILE_INTERVAL_MS = '12345';
        vi.resetModules();
        const config = await import('../config');
        expect(config.RECONCILE_INTERVAL_MS).toBe(12345);
    });

    it('ignores non-numeric env values', async () => {
        process.env.CONCERTO_RECONCILE_INTERVAL_MS = 'not-a-number';
        vi.resetModules();
        const config = await import('../config');
        expect(config.RECONCILE_INTERVAL_MS).toBe(30_000);
    });
});
