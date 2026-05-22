import fs from 'node:fs';
import { DAEMON_INFO_FILE } from './paths';

export interface DaemonInfo {
    port: number;
    token: string;
    pid: number;
    started_at?: number;
}

export function readDaemonInfo(): DaemonInfo | null {
    try {
        const raw = fs.readFileSync(DAEMON_INFO_FILE, 'utf8');
        const parsed = JSON.parse(raw) as DaemonInfo;
        if (typeof parsed.port !== 'number' || typeof parsed.token !== 'string') return null;
        return parsed;
    } catch {
        return null;
    }
}

export function isPidAlive(pid: number): boolean {
    if (!pid || pid <= 0) return false;
    try {
        // Signal 0 is the standard liveness probe — throws ESRCH on dead pids.
        process.kill(pid, 0);
        return true;
    } catch {
        return false;
    }
}

/**
 * Read ~/.coro/daemon.json and validate the PID is alive. Returns null if
 * the file is missing, malformed, or points to a dead process.
 */
export function discover(): DaemonInfo | null {
    const info = readDaemonInfo();
    if (!info) return null;
    if (info.pid && !isPidAlive(info.pid)) return null;
    return info;
}
