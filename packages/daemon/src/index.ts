import fs from 'fs';
import path from 'path';
import {
    CORO_HOME,
    DEFAULT_API_PORT,
    LOG_FILE,
    RECONCILE_INTERVAL_MS,
    STASH_GC_INTERVAL_MS,
    STASH_MAX_AGE_MS,
    createLogger,
    setLogSink,
    getDb,
    worktrees,
} from '@coro/core';
import { DaemonClient } from '@coro/client';
import { startServer } from './server';
import { generateToken, writeDaemonInfo, clearDaemonInfo } from './auth';

const PID_FILE = path.join(CORO_HOME, 'daemon.pid');
const LOG_ROTATE_BYTES = 10 * 1024 * 1024; // 10MB cap; rotates to .1/.2/.3
const LOG_ROTATE_KEEP = 3;

function mcpBridgeScript(): string {
    return path.resolve(__dirname, '..', 'bin', 'coro-mcp.mjs');
}

interface LogFileSink {
    stream: fs.WriteStream;
    maybeRotate(): void;
}

// File sink for daemon.log with size-based rotation. We check the on-disk
// size on every write; cheap enough since we're already incurring the syscall
// for the append. When the file crosses the threshold we shift .2 → .3,
// .1 → .2, current → .1 and open a fresh stream.
function openRotatingLogFile(): LogFileSink {
    fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
    let stream = fs.createWriteStream(LOG_FILE, { flags: 'a' });
    let bytes = (() => { try { return fs.statSync(LOG_FILE).size; } catch { return 0; } })();
    const orig = stream.write.bind(stream);
    const wrapped = ((chunk: any, ...rest: any[]) => {
        if (typeof chunk === 'string') bytes += Buffer.byteLength(chunk);
        else if (Buffer.isBuffer(chunk)) bytes += chunk.length;
        return orig(chunk, ...rest);
    }) as typeof stream.write;
    stream.write = wrapped;

    const maybeRotate = () => {
        if (bytes < LOG_ROTATE_BYTES) return;
        try {
            stream.end();
            for (let i = LOG_ROTATE_KEEP - 1; i >= 1; i--) {
                const src = `${LOG_FILE}.${i}`;
                const dst = `${LOG_FILE}.${i + 1}`;
                try { fs.renameSync(src, dst); } catch { /* missing rung is fine */ }
            }
            try { fs.renameSync(LOG_FILE, `${LOG_FILE}.1`); } catch {}
            stream = fs.createWriteStream(LOG_FILE, { flags: 'a' });
            bytes = 0;
            const o = stream.write.bind(stream);
            const w = ((chunk: any, ...rest: any[]) => {
                if (typeof chunk === 'string') bytes += Buffer.byteLength(chunk);
                else if (Buffer.isBuffer(chunk)) bytes += chunk.length;
                return o(chunk, ...rest);
            }) as typeof stream.write;
            stream.write = w;
            sink.stream = stream;
            setLogSink(stream);
        } catch {
            // rotation failed; keep the old stream so we don't drop logs
        }
    };
    const sink: LogFileSink = { stream, maybeRotate };
    return sink;
}

async function main() {
    fs.mkdirSync(CORO_HOME, { recursive: true });

    const logSink = openRotatingLogFile();
    setLogSink(logSink.stream);
    const log = createLogger('daemon');
    // Rotation check runs on a slow interval; size is updated lazily so this
    // is fine to leave at the default tick rather than wiring into every write.
    const rotateTimer = setInterval(() => logSink.maybeRotate(), 60_000);
    rotateTimer.unref?.();

    getDb();

    const port = parseInt(process.env.CORO_API_PORT || String(DEFAULT_API_PORT), 10);
    const token = generateToken();
    const startedAt = Date.now();

    // The MCP bridge path is set on the env so DaemonClient.writeMcpConfig
    // (called from the worktree-created hook) can find it without us shipping
    // the path through core.
    process.env.CORO_MCP_BRIDGE = mcpBridgeScript();

    const client = new DaemonClient({ base: `http://localhost:${port}`, token });
    worktrees.onWorktreeCreated(({ worktreePath, cardId }) => {
        void client.writeMcpConfig(worktreePath, cardId);
    });

    const server = startServer({ port, token, startedAt });

    const reconcileTimer = setInterval(() => {
        try {
            const result = worktrees.reconcile();
            if (result.missing.length > 0) log.info('reconcile flagged missing worktrees', { cards: result.missing });
            if (result.reactivated.length > 0) log.info('reconcile reactivated worktrees', { cards: result.reactivated });
        } catch (err: any) {
            log.error('reconcile failed', { error: err?.message || String(err) });
        }
    }, RECONCILE_INTERVAL_MS);
    reconcileTimer.unref?.();

    const gcSweep = () => {
        try {
            const { deleted } = worktrees.pruneAbandonedStashes(STASH_MAX_AGE_MS);
            if (deleted.length > 0) log.info('stash GC pruned refs', { count: deleted.length });
        } catch (err: any) {
            log.error('stash GC failed', { error: err?.message || String(err) });
        }
    };
    setImmediate(gcSweep);
    const gcTimer = setInterval(gcSweep, STASH_GC_INTERVAL_MS);
    gcTimer.unref?.();

    fs.writeFileSync(PID_FILE, String(process.pid));
    writeDaemonInfo({ port, token, pid: process.pid, started_at: startedAt });

    log.info('listening', { url: `http://localhost:${port}` });

    const shutdown = (signal: string) => {
        log.info('shutting down', { signal });
        server.close();
        try { fs.unlinkSync(PID_FILE); } catch {}
        clearDaemonInfo();
        process.exit(0);
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
    // Logger may not be initialized yet; fall back to stderr.
    process.stderr.write(`[daemon] fatal: ${err?.stack || err}\n`);
    process.exit(1);
});
