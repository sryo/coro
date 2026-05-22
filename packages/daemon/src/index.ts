import fs from 'fs';
import path from 'path';
import {
    CONCERTO_HOME,
    DEFAULT_API_PORT,
    RECONCILE_INTERVAL_MS,
    STASH_GC_INTERVAL_MS,
    STASH_MAX_AGE_MS,
    getDb,
    worktrees,
} from '@concerto/core';
import { DaemonClient } from '@concerto/client';
import { startServer } from './server';
import { generateToken, writeDaemonInfo, clearDaemonInfo } from './auth';

const PID_FILE = path.join(CONCERTO_HOME, 'daemon.pid');

function mcpBridgeScript(): string {
    return path.resolve(__dirname, '..', 'bin', 'concerto-mcp.mjs');
}

async function main() {
    fs.mkdirSync(CONCERTO_HOME, { recursive: true });

    getDb();

    const port = parseInt(process.env.CONCERTO_API_PORT || String(DEFAULT_API_PORT), 10);
    const token = generateToken();
    const startedAt = Date.now();

    // The MCP bridge path is set on the env so DaemonClient.writeMcpConfig
    // (called from the worktree-created hook) can find it without us shipping
    // the path through core.
    process.env.CONCERTO_MCP_BRIDGE = mcpBridgeScript();

    const client = new DaemonClient({ base: `http://localhost:${port}`, token });
    worktrees.onWorktreeCreated(({ worktreePath, cardId }) => {
        void client.writeMcpConfig(worktreePath, cardId);
    });

    const server = startServer({ port, token, startedAt });

    const reconcileTimer = setInterval(() => {
        try {
            const result = worktrees.reconcile();
            if (result.missing.length > 0) console.log(`[reconcile] flagged missing: ${result.missing.join(',')}`);
            if (result.reactivated.length > 0) console.log(`[reconcile] reactivated: ${result.reactivated.join(',')}`);
        } catch (err: any) {
            console.error('[reconcile] failed:', err?.message || err);
        }
    }, RECONCILE_INTERVAL_MS);
    reconcileTimer.unref?.();

    const gcSweep = () => {
        try {
            const { deleted } = worktrees.pruneAbandonedStashes(STASH_MAX_AGE_MS);
            if (deleted.length > 0) console.log(`[stash-gc] pruned ${deleted.length} ref(s)`);
        } catch (err: any) {
            console.error('[stash-gc] failed:', err?.message || err);
        }
    };
    setImmediate(gcSweep);
    const gcTimer = setInterval(gcSweep, STASH_GC_INTERVAL_MS);
    gcTimer.unref?.();

    fs.writeFileSync(PID_FILE, String(process.pid));
    writeDaemonInfo({ port, token, pid: process.pid, started_at: startedAt });

    console.log(`[daemon] listening on http://localhost:${port}`);

    const shutdown = (signal: string) => {
        console.log(`[daemon] received ${signal}, shutting down`);
        server.close();
        try { fs.unlinkSync(PID_FILE); } catch {}
        clearDaemonInfo();
        process.exit(0);
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
    console.error('[daemon] fatal:', err);
    process.exit(1);
});
