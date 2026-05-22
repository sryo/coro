import fs from 'node:fs';
import path from 'node:path';
import { spawn, execSync } from 'node:child_process';
import {
    CONCERTO_HOME,
    DAEMON_LOCK_FILE,
    DAEMON_LOG_FILE,
    SPAWN_POLL_MS,
    SPAWN_WAIT_MS,
    SSE_BACKOFF_MAX_MS,
    SSE_BACKOFF_MIN_MS,
    SSE_HEARTBEAT_TIMEOUT_MS,
} from './paths';
import { discover, readDaemonInfo, isPidAlive, type DaemonInfo } from './discover';

// Re-exported for the lock-contention test in __tests__/lock.test.ts.
export { discover } from './discover';
export type { DaemonInfo } from './discover';

export interface DaemonClientOpts {
    // Override discovery. Useful for tests or for processes that already know the URL.
    base?: string;
    token?: string;
}

export interface EnsureRunningOpts {
    spawn?: boolean;
}

export interface DaemonRuntime {
    base: string;
    port: number;
    token: string;
}

export interface RequestError extends Error {
    status: number;
    body: unknown;
}

export interface StreamHandle {
    close(): void;
}

export interface StreamOpts {
    onError?: (err: Error) => void;
    // Event names to subscribe to. If omitted, the client listens for the broad set the daemon emits.
    events?: string[];
}

const DEFAULT_EVENT_NAMES = [
    'connected',
    'heartbeat',
    'card:message',
    'card:turn_started',
    'card:text_stream',
    'card:turn_complete',
    'card:turn_failed',
    'card:usage',
    'card:error',
    'card:stage_changed',
    'card:note',
    'card:abandoned',
    'card:merged',
    'card:worktree_changed',
    'worktree:created',
    'worktree:removed',
];

function sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
}

function findConcertoBin(): string | null {
    try {
        const which = execSync('command -v coro', { encoding: 'utf8' }).trim();
        if (which && fs.existsSync(which)) return which;
    } catch {
        // not on PATH; fall through to sibling lookup
    }
    // Sibling install: client lives in packages/client/dist, daemon bin sits at packages/daemon/bin.
    const sibling = path.resolve(__dirname, '..', '..', 'daemon', 'bin', 'coro.mjs');
    if (fs.existsSync(sibling)) return sibling;
    return null;
}

function tryAcquireLock(): number | null {
    try {
        return fs.openSync(DAEMON_LOCK_FILE, 'wx');
    } catch {
        return null;
    }
}

function releaseLock(fd: number): void {
    try { fs.closeSync(fd); } catch {}
    try { fs.unlinkSync(DAEMON_LOCK_FILE); } catch {}
}

// Test seam: allows the lock-contention test to substitute spawning a real
// daemon for a synchronous "write daemon.json" stub. Production code never
// calls this.
let spawnImpl: () => Promise<void> = defaultSpawn;
export function _setSpawnerForTests(fn: (() => Promise<void>) | null): void {
    spawnImpl = fn ?? defaultSpawn;
}

async function defaultSpawn(): Promise<void> {
    const bin = findConcertoBin();
    if (!bin) {
        throw new Error('concerto binary not found — install with `npm i -g concerto` or run install.sh from the source tree');
    }
    fs.mkdirSync(CONCERTO_HOME, { recursive: true });
    const out = fs.openSync(DAEMON_LOG_FILE, 'a');
    const child = spawn(bin, ['daemon', 'start'], { detached: true, stdio: ['ignore', out, out] });
    child.unref();
}

async function spawnDaemon(): Promise<void> {
    return spawnImpl();
}

async function waitForDaemon(): Promise<DaemonInfo | null> {
    const deadline = Date.now() + SPAWN_WAIT_MS;
    while (Date.now() < deadline) {
        const info = discover();
        if (info) return info;
        await sleep(SPAWN_POLL_MS);
    }
    return null;
}

export class DaemonClient {
    private base: string | null;
    private token: string | null;

    constructor(opts: DaemonClientOpts = {}) {
        this.base = opts.base ?? null;
        this.token = opts.token ?? null;
    }

    /** Read ~/.concerto/daemon.json. Null if missing or PID is dead. */
    discover(): DaemonInfo | null {
        return discover();
    }

    /**
     * Discover the daemon, spawning if necessary. Concurrent callers share one
     * spawn: the second caller blocks on the lock and then picks up the daemon
     * the first one launched.
     */
    async ensureRunning(opts: EnsureRunningOpts = {}): Promise<DaemonRuntime> {
        const allowSpawn = opts.spawn !== false;

        const existing = this.discover();
        if (existing) return this.cacheAndReturn(existing);

        if (!allowSpawn) {
            throw new Error('concerto daemon is not running');
        }

        fs.mkdirSync(CONCERTO_HOME, { recursive: true });

        // Race for the lock. Winner spawns; losers wait for daemon.json to appear.
        const lockDeadline = Date.now() + SPAWN_WAIT_MS;
        let fd: number | null = null;
        while (Date.now() < lockDeadline) {
            // Re-check discovery on every loop iteration in case someone else's
            // spawn completed while we were waiting.
            const found = this.discover();
            if (found) return this.cacheAndReturn(found);
            fd = tryAcquireLock();
            if (fd !== null) break;
            await sleep(SPAWN_POLL_MS);
        }

        if (fd === null) {
            // Someone else holds the lock but their daemon never came up. Treat as failure.
            const lastChance = await waitForDaemon();
            if (lastChance) return this.cacheAndReturn(lastChance);
            throw new Error(`daemon did not start; check ${DAEMON_LOG_FILE}`);
        }

        try {
            // Double-check after acquiring the lock — another process may have published daemon.json
            // between our last discover() and our lock acquisition.
            const recheck = this.discover();
            if (recheck) return this.cacheAndReturn(recheck);
            await spawnDaemon();
            const info = await waitForDaemon();
            if (!info) throw new Error(`daemon did not start; check ${DAEMON_LOG_FILE}`);
            return this.cacheAndReturn(info);
        } finally {
            releaseLock(fd);
        }
    }

    private cacheAndReturn(info: DaemonInfo): DaemonRuntime {
        const base = `http://localhost:${info.port}`;
        this.base = base;
        this.token = info.token;
        return { base, port: info.port, token: info.token };
    }

    private async resolveRuntime(): Promise<DaemonRuntime> {
        if (this.base && this.token) {
            return { base: this.base, port: 0, token: this.token };
        }
        return this.ensureRunning();
    }

    /**
     * Authenticated JSON request. Throws on non-2xx with `.status` and `.body`.
     * If `init.body` is a non-string, it is JSON.stringify'd and a Content-Type header added.
     */
    async request<T>(urlPath: string, init: RequestInit = {}): Promise<T> {
        const { base, token } = await this.resolveRuntime();
        const headers = new Headers(init.headers);
        headers.set('Authorization', `Bearer ${token}`);

        let body = init.body;
        if (body !== undefined && body !== null && typeof body !== 'string' && !(body instanceof Uint8Array)) {
            body = JSON.stringify(body);
            if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
        }

        const res = await fetch(base + urlPath, { ...init, headers, body: body as RequestInit['body'] });
        const text = await res.text();
        const parsed = text ? safeJson(text) : null;
        if (!res.ok) {
            const err = new Error(extractMessage(parsed) || `HTTP ${res.status}`) as RequestError;
            err.status = res.status;
            err.body = parsed;
            throw err;
        }
        return parsed as T;
    }

    /**
     * Subscribe to an SSE endpoint. The handler receives every named event the
     * daemon emits; the client reconnects with exponential backoff on
     * disconnect or heartbeat timeout (no event within SSE_HEARTBEAT_TIMEOUT_MS).
     */
    stream(urlPath: string, onEvent: (type: string, data: unknown) => void, opts: StreamOpts = {}): StreamHandle {
        const events = opts.events ?? DEFAULT_EVENT_NAMES;
        let closed = false;
        let controller: AbortController | null = null;
        let backoff = SSE_BACKOFF_MIN_MS;
        let watchdog: NodeJS.Timeout | null = null;

        const resetWatchdog = () => {
            if (watchdog) clearTimeout(watchdog);
            watchdog = setTimeout(() => {
                // Force reconnect by aborting the current stream.
                controller?.abort();
            }, SSE_HEARTBEAT_TIMEOUT_MS);
        };

        const connect = async () => {
            if (closed) return;
            controller = new AbortController();
            let runtime: DaemonRuntime;
            try {
                runtime = await this.resolveRuntime();
            } catch (err) {
                opts.onError?.(err as Error);
                return scheduleReconnect();
            }
            try {
                const res = await fetch(runtime.base + urlPath, {
                    headers: { Authorization: `Bearer ${runtime.token}`, Accept: 'text/event-stream' },
                    signal: controller.signal,
                });
                if (!res.ok || !res.body) {
                    opts.onError?.(new Error(`SSE failed: HTTP ${res.status}`));
                    return scheduleReconnect();
                }
                // Connected — reset backoff and start the heartbeat watchdog.
                backoff = SSE_BACKOFF_MIN_MS;
                resetWatchdog();
                await readEvents(res.body, events, (type, data) => {
                    resetWatchdog();
                    onEvent(type, data);
                });
                // Stream ended cleanly; reconnect after the backoff.
                scheduleReconnect();
            } catch (err) {
                if (closed) return;
                opts.onError?.(err as Error);
                scheduleReconnect();
            }
        };

        const scheduleReconnect = () => {
            if (closed) return;
            if (watchdog) { clearTimeout(watchdog); watchdog = null; }
            const wait = backoff;
            backoff = Math.min(backoff * 2, SSE_BACKOFF_MAX_MS);
            setTimeout(() => { void connect(); }, wait);
        };

        void connect();

        return {
            close: () => {
                closed = true;
                if (watchdog) { clearTimeout(watchdog); watchdog = null; }
                controller?.abort();
            },
        };
    }

    /**
     * Write a .mcp.json into a worktree so a per-card Claude session can talk
     * to the daemon. Daemon sets CONCERTO_MCP_BRIDGE at startup; we fall back
     * to the sibling install if the env var isn't set.
     */
    async writeMcpConfig(worktreePath: string, cardId: string): Promise<void> {
        const runtime = await this.resolveRuntime();
        const bridge = process.env.CONCERTO_MCP_BRIDGE || defaultBridgeScript();
        if (!bridge) return;
        const config = {
            mcpServers: {
                concerto: {
                    command: 'node',
                    args: [bridge],
                    env: {
                        CONCERTO_CARD_ID: cardId,
                        CONCERTO_DAEMON_URL: runtime.base,
                        CONCERTO_DAEMON_TOKEN: runtime.token,
                    },
                },
            },
        };
        try {
            fs.writeFileSync(path.join(worktreePath, '.mcp.json'), JSON.stringify(config, null, 2));
        } catch {
            // best-effort
        }
    }
}

function defaultBridgeScript(): string | null {
    const sibling = path.resolve(__dirname, '..', '..', 'daemon', 'bin', 'coro-mcp.mjs');
    return fs.existsSync(sibling) ? sibling : null;
}

function safeJson(text: string): unknown {
    try { return JSON.parse(text); } catch { return text; }
}

function extractMessage(body: unknown): string | null {
    if (body && typeof body === 'object' && 'error' in body) {
        const err = (body as { error: unknown }).error;
        if (err && typeof err === 'object' && 'message' in err && typeof (err as { message: unknown }).message === 'string') {
            return (err as { message: string }).message;
        }
    }
    return null;
}

async function readEvents(
    body: ReadableStream<Uint8Array>,
    knownTypes: string[],
    onEvent: (type: string, data: unknown) => void,
): Promise<void> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    const knownSet = new Set(knownTypes);

    while (true) {
        const { value, done } = await reader.read();
        if (done) return;
        buffer += decoder.decode(value, { stream: true });
        // SSE frames are separated by blank lines.
        const parts = buffer.split('\n\n');
        buffer = parts.pop() ?? '';
        for (const frame of parts) {
            const lines = frame.split('\n');
            let type = 'message';
            const dataLines: string[] = [];
            for (const line of lines) {
                if (line.startsWith(':')) continue; // comment / heartbeat ping
                if (line.startsWith('event:')) type = line.slice(6).trim();
                else if (line.startsWith('data:')) dataLines.push(line.slice(5).replace(/^ /, ''));
            }
            // Comment-only frames still count as activity for the watchdog: onEvent caller resets there.
            if (dataLines.length === 0 && !knownSet.has(type)) continue;
            const dataText = dataLines.join('\n');
            let parsed: unknown = dataText;
            if (dataText) {
                try { parsed = JSON.parse(dataText); } catch { /* keep raw */ }
            }
            onEvent(type, parsed);
        }
    }
}

