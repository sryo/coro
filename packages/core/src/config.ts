import path from 'path';
import os from 'os';
import type { StageKind } from '@coro/types';

export type { StageKind } from '@coro/types';

export const CORO_HOME = process.env.CORO_HOME
    || path.join(os.homedir(), '.coro');

export const DB_FILE = path.join(CORO_HOME, 'state.db');
export const DAEMON_INFO_FILE = path.join(CORO_HOME, 'daemon.json');
export const LOG_FILE = path.join(CORO_HOME, 'daemon.log');

export const DEFAULT_API_PORT = 7419;
export const DEFAULT_DASHBOARD_PORT = 7420;

export const DEFAULT_STAGES: ReadonlyArray<{ name: string; kind: StageKind }> = [
    { name: 'Backlog', kind: 'backlog' },
    { name: 'Ready', kind: 'ready' },
    { name: 'In Progress', kind: 'active' },
    { name: 'Testing', kind: 'active' },
    { name: 'Review', kind: 'review' },
    { name: 'Done', kind: 'done' },
    { name: 'Merged', kind: 'archive' },
];

function intFromEnv(name: string, fallback: number): number {
    const raw = process.env[name];
    if (!raw) return fallback;
    const n = parseInt(raw, 10);
    return Number.isFinite(n) && n > 0 ? n : fallback;
}

// How often the daemon checks worktrees on disk for drift (missing / dirty / behind).
export const RECONCILE_INTERVAL_MS = intFromEnv('CORO_RECONCILE_INTERVAL_MS', 30_000);

// How often the daemon sweeps refs/coro-abandoned/* for stashes past the max age.
export const STASH_GC_INTERVAL_MS = intFromEnv('CORO_STASH_GC_INTERVAL_MS', 24 * 60 * 60 * 1000);

// Stashed abandoned worktrees older than this are pruned by the GC sweep.
export const STASH_MAX_AGE_MS = intFromEnv('CORO_STASH_MAX_AGE_MS', 30 * 24 * 60 * 60 * 1000);

// "Rebase" badge appears when the worktree is at least this many commits behind base.
export const STALE_BEHIND_THRESHOLD = intFromEnv('CORO_STALE_BEHIND_THRESHOLD', 10);

// Cap on a single diff response — anything over this gets truncated to keep responses bounded.
export const DIFF_BYTE_CAP = intFromEnv('CORO_DIFF_BYTE_CAP', 1_000_000);
