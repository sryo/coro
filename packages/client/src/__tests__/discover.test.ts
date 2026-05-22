import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

function tempHome(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'coro-client-test-'));
}

describe('DaemonClient.discover', () => {
    let home: string;
    const originalHome = process.env.CORO_HOME;

    beforeEach(() => {
        home = tempHome();
        process.env.CORO_HOME = home;
        vi.resetModules();
    });

    afterEach(() => {
        if (originalHome === undefined) delete process.env.CORO_HOME;
        else process.env.CORO_HOME = originalHome;
        try { fs.rmSync(home, { recursive: true, force: true }); } catch {}
    });

    it('returns null when daemon.json is missing', async () => {
        const { DaemonClient } = await import('../index');
        const client = new DaemonClient();
        expect(client.discover()).toBeNull();
    });

    it('returns null when daemon.json points to a dead PID', async () => {
        const { DaemonClient } = await import('../index');
        // PID 999999 is essentially guaranteed not to exist on this machine.
        fs.writeFileSync(path.join(home, 'daemon.json'), JSON.stringify({
            port: 7419,
            token: 'fake',
            pid: 999999,
            started_at: Date.now(),
        }));
        const client = new DaemonClient();
        expect(client.discover()).toBeNull();
    });

    it('returns the info when the PID is the running test process', async () => {
        const { DaemonClient } = await import('../index');
        fs.writeFileSync(path.join(home, 'daemon.json'), JSON.stringify({
            port: 7419,
            token: 'fake-token',
            pid: process.pid,
            started_at: Date.now(),
        }));
        const client = new DaemonClient();
        const info = client.discover();
        expect(info).not.toBeNull();
        expect(info?.port).toBe(7419);
        expect(info?.token).toBe('fake-token');
    });

    it('returns null when daemon.json is malformed', async () => {
        const { DaemonClient } = await import('../index');
        fs.writeFileSync(path.join(home, 'daemon.json'), '{not valid json');
        const client = new DaemonClient();
        expect(client.discover()).toBeNull();
    });
});
