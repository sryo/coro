// Small structured logger used by the daemon and core modules. JSON-lines to
// stderr when CORO_LOG_FORMAT=json (machine-friendly for log aggregation);
// otherwise a short "HH:MM:SS LEVEL [scope] message" line. Level defaults to
// info; debug noise stays off unless explicitly opted in.

import type { WriteStream } from 'node:fs';

type Level = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_RANK: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

function envLevel(): Level {
    const raw = (process.env.CORO_LOG_LEVEL || 'info').toLowerCase();
    return (raw in LEVEL_RANK ? raw : 'info') as Level;
}

function isJson(): boolean {
    return process.env.CORO_LOG_FORMAT === 'json';
}

// Optional sink for tests or the daemon's file rotation. When unset we just
// write to process.stderr.
let extraSink: NodeJS.WritableStream | WriteStream | null = null;

export function setLogSink(sink: NodeJS.WritableStream | WriteStream | null): void {
    extraSink = sink;
}

function format(level: Level, scope: string, message: string, fields?: Record<string, unknown>): string {
    if (isJson()) {
        return JSON.stringify({ ts: new Date().toISOString(), level, scope, message, ...(fields || {}) }) + '\n';
    }
    const t = new Date().toISOString().slice(11, 19);
    const tail = fields && Object.keys(fields).length > 0 ? ' ' + JSON.stringify(fields) : '';
    return `${t} ${level.toUpperCase().padEnd(5)} [${scope}] ${message}${tail}\n`;
}

function write(level: Level, scope: string, message: string, fields?: Record<string, unknown>): void {
    if (LEVEL_RANK[level] < LEVEL_RANK[envLevel()]) return;
    const line = format(level, scope, message, fields);
    process.stderr.write(line);
    if (extraSink) {
        try { extraSink.write(line); } catch { /* sink down; logging never throws */ }
    }
}

export interface Logger {
    debug(message: string, fields?: Record<string, unknown>): void;
    info(message: string, fields?: Record<string, unknown>): void;
    warn(message: string, fields?: Record<string, unknown>): void;
    error(message: string, fields?: Record<string, unknown>): void;
}

export function createLogger(scope: string): Logger {
    return {
        debug: (m, f) => write('debug', scope, m, f),
        info: (m, f) => write('info', scope, m, f),
        warn: (m, f) => write('warn', scope, m, f),
        error: (m, f) => write('error', scope, m, f),
    };
}
