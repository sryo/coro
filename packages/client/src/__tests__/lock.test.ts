import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

function tempHome(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'coro-client-test-'));
}

describe('DaemonClient.ensureRunning lock contention', () => {
    let home: string;
    const originalHome = process.env.CORO_HOME;

    beforeEach(() => {
        home = tempHome();
        process.env.CORO_HOME = home;
        // Tighten polls so the test finishes in well under a second.
        process.env.CORO_SPAWN_POLL_MS = '20';
        process.env.CORO_SPAWN_WAIT_MS = '5000';
        vi.resetModules();
    });

    afterEach(() => {
        if (originalHome === undefined) delete process.env.CORO_HOME;
        else process.env.CORO_HOME = originalHome;
        delete process.env.CORO_SPAWN_POLL_MS;
        delete process.env.CORO_SPAWN_WAIT_MS;
        try { fs.rmSync(home, { recursive: true, force: true }); } catch {}
    });

    it('two concurrent ensureRunning calls share one spawn and converge on the same daemon info', async () => {
        const { DaemonClient, _setSpawnerForTests } = await import('../index');

        let spawnCount = 0;
        // Fake "daemon": writes daemon.json on the first call only. If a second
        // caller bypassed the lock, spawnCount would tick up to 2.
        _setSpawnerForTests(async () => {
            spawnCount++;
            // Simulate a small startup delay so the loser is forced to wait.
            await new Promise((r) => setTimeout(r, 50));
            fs.writeFileSync(path.join(home, 'daemon.json'), JSON.stringify({
                port: 12345,
                token: 'shared-token',
                pid: process.pid,
                started_at: Date.now(),
            }));
        });

        try {
            const a = new DaemonClient();
            const b = new DaemonClient();
            const [resA, resB] = await Promise.all([a.ensureRunning(), b.ensureRunning()]);

            expect(spawnCount).toBe(1);
            expect(resA.port).toBe(12345);
            expect(resB.port).toBe(12345);
            expect(resA.token).toBe('shared-token');
            expect(resB.token).toBe('shared-token');
        } finally {
            _setSpawnerForTests(null);
        }
    });

    it('returns immediately when daemon.json already exists for a live PID', async () => {
        const { DaemonClient, _setSpawnerForTests } = await import('../index');

        let spawnCalled = false;
        _setSpawnerForTests(async () => { spawnCalled = true; });

        try {
            fs.writeFileSync(path.join(home, 'daemon.json'), JSON.stringify({
                port: 7777,
                token: 'preexisting',
                pid: process.pid,
                started_at: Date.now(),
            }));

            const client = new DaemonClient();
            const res = await client.ensureRunning();
            expect(spawnCalled).toBe(false);
            expect(res.port).toBe(7777);
            expect(res.token).toBe('preexisting');
        } finally {
            _setSpawnerForTests(null);
        }
    });
});
