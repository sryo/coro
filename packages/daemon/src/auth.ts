import fs from 'fs';
import { nanoid } from 'nanoid';
import { DAEMON_INFO_FILE, CORO_HOME } from '@coro/core';
import path from 'path';

export interface DaemonInfo {
    port: number;
    token: string;
    pid: number;
    started_at: number;
}

export function writeDaemonInfo(info: DaemonInfo): void {
    fs.mkdirSync(path.dirname(DAEMON_INFO_FILE), { recursive: true });
    fs.writeFileSync(DAEMON_INFO_FILE, JSON.stringify(info, null, 2));
    fs.chmodSync(DAEMON_INFO_FILE, 0o600);
}

export function readDaemonInfo(): DaemonInfo | null {
    try {
        return JSON.parse(fs.readFileSync(DAEMON_INFO_FILE, 'utf8'));
    } catch {
        return null;
    }
}

export function clearDaemonInfo(): void {
    try { fs.unlinkSync(DAEMON_INFO_FILE); } catch {}
}

export function generateToken(): string {
    return nanoid(32);
}

export function verifyAuth(authHeader: string | undefined, expected: string): boolean {
    if (!authHeader) return false;
    const m = /^Bearer\s+(.+)$/i.exec(authHeader);
    if (!m) return false;
    return m[1] === expected;
}
