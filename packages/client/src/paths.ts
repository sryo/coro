import path from 'node:path';
import os from 'node:os';

function intFromEnv(name: string, fallback: number): number {
    const raw = process.env[name];
    if (!raw) return fallback;
    const n = parseInt(raw, 10);
    return Number.isFinite(n) && n > 0 ? n : fallback;
}

export const CONCERTO_HOME = process.env.CONCERTO_HOME
    || path.join(os.homedir(), '.concerto');

export const DAEMON_INFO_FILE = path.join(CONCERTO_HOME, 'daemon.json');
export const DAEMON_LOCK_FILE = path.join(CONCERTO_HOME, 'daemon.lock');
export const DAEMON_LOG_FILE = path.join(CONCERTO_HOME, 'daemon.log');

// How long to wait for another concurrent spawn (or for the daemon to publish daemon.json) before giving up.
export const SPAWN_WAIT_MS = intFromEnv('CONCERTO_SPAWN_WAIT_MS', 5_000);

// Backoff polling interval while waiting for daemon.json to appear.
export const SPAWN_POLL_MS = intFromEnv('CONCERTO_SPAWN_POLL_MS', 150);

// SSE: cap reconnect backoff at 30s. Initial wait is 500ms, doubled each failure.
export const SSE_BACKOFF_MIN_MS = intFromEnv('CONCERTO_SSE_BACKOFF_MIN_MS', 500);
export const SSE_BACKOFF_MAX_MS = intFromEnv('CONCERTO_SSE_BACKOFF_MAX_MS', 30_000);

// If no event arrives within this window (including heartbeats), force a reconnect.
export const SSE_HEARTBEAT_TIMEOUT_MS = intFromEnv('CONCERTO_SSE_HEARTBEAT_TIMEOUT_MS', 60_000);
