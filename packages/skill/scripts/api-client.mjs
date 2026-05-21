// Thin HTTP client used by every concerto skill script. Reusable across verbs.
//
// Usage:
//   import { discover, api } from './api-client.mjs';
//   const { port, token } = await discover();
//   const project = await api(port, token).get(`/projects/by-path?path=${encodeURIComponent(repo)}`);

import fs from 'fs';
import path from 'path';
import os from 'os';
import { spawn } from 'child_process';
import { execSync } from 'child_process';

const CONCERTO_HOME = process.env.CONCERTO_HOME || path.join(os.homedir(), '.concerto');
const DAEMON_INFO_FILE = path.join(CONCERTO_HOME, 'daemon.json');
const LOG_FILE = path.join(CONCERTO_HOME, 'daemon.log');

function readInfo() {
    try { return JSON.parse(fs.readFileSync(DAEMON_INFO_FILE, 'utf8')); } catch { return null; }
}

async function health(port, token) {
    try {
        const res = await fetch(`http://localhost:${port}/health`, {
            headers: { Authorization: `Bearer ${token}` },
        });
        return res.ok;
    } catch { return false; }
}

function findConcertoBin() {
    try {
        const which = execSync('command -v concerto', { encoding: 'utf8' }).trim();
        if (which && fs.existsSync(which)) return which;
    } catch {}
    const here = path.dirname(new URL(import.meta.url).pathname);
    const sibling = path.resolve(here, '../../daemon/bin/concerto.mjs');
    return fs.existsSync(sibling) ? sibling : null;
}

export async function discover() {
    let info = readInfo();
    if (info && await health(info.port, info.token)) return info;

    const bin = findConcertoBin();
    if (!bin) {
        throw new Error('concerto binary not found — install with `npm i -g concerto` or run install.sh from the source tree');
    }
    fs.mkdirSync(CONCERTO_HOME, { recursive: true });
    const out = fs.openSync(LOG_FILE, 'a');
    const child = spawn(bin, ['daemon', 'start'], { detached: true, stdio: ['ignore', out, out] });
    child.unref();

    const start = Date.now();
    while (Date.now() - start < 3000) {
        await new Promise((r) => setTimeout(r, 150));
        info = readInfo();
        if (info && await health(info.port, info.token)) return info;
    }
    throw new Error(`daemon did not start; check ${LOG_FILE}`);
}

export function api(port, token) {
    const base = `http://localhost:${port}`;
    const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

    async function call(method, urlPath, body) {
        const res = await fetch(base + urlPath, {
            method,
            headers,
            body: body === undefined ? undefined : JSON.stringify(body),
        });
        const text = await res.text();
        const json = text ? (() => { try { return JSON.parse(text); } catch { return text; } })() : null;
        if (!res.ok) {
            const err = new Error((json?.error?.message) || `HTTP ${res.status}`);
            err.status = res.status;
            err.body = json;
            throw err;
        }
        return json;
    }

    return {
        get: (p) => call('GET', p),
        post: (p, body) => call('POST', p, body ?? {}),
        patch: (p, body) => call('PATCH', p, body ?? {}),
        put: (p, body) => call('PUT', p, body ?? {}),
        delete: (p) => call('DELETE', p),
    };
}

export function repoRoot() {
    try {
        return execSync('git rev-parse --show-toplevel', { encoding: 'utf8' }).trim();
    } catch {
        throw new Error('not in a git repo (run `git init` first)');
    }
}
