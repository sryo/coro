// Server-only: read the daemon.json that the running daemon writes.
import fs from 'fs';
import path from 'path';
import os from 'os';

interface DaemonInfo {
    port: number;
    token: string;
    pid: number;
    started_at: number;
}

const HOME = process.env.CONCERTO_HOME || path.join(os.homedir(), '.concerto');
const INFO_FILE = path.join(HOME, 'daemon.json');

export function readDaemonInfo(): DaemonInfo | null {
    try {
        return JSON.parse(fs.readFileSync(INFO_FILE, 'utf8'));
    } catch {
        return null;
    }
}

export function daemonBase(): string | null {
    const info = readDaemonInfo();
    return info ? `http://localhost:${info.port}` : null;
}

export function daemonToken(): string | null {
    return readDaemonInfo()?.token ?? null;
}
