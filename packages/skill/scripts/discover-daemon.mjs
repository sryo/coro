#!/usr/bin/env node
// Find the running daemon or auto-spawn it. Prints {port, token} as JSON on success.

import fs from 'fs';
import path from 'path';
import os from 'os';
import { spawn } from 'child_process';

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
    } catch {
        return false;
    }
}

async function probe() {
    const info = readInfo();
    if (!info) return null;
    return (await health(info.port, info.token)) ? info : null;
}

function findConcertoBin() {
    // 1. PATH
    const which = (() => {
        try {
            const { execSync } = require('child_process');
            return execSync('command -v concerto', { encoding: 'utf8' }).trim();
        } catch { return ''; }
    })();
    if (which && fs.existsSync(which)) return which;
    // 2. Sibling install (skill installed alongside the daemon package)
    const sibling = path.resolve(import.meta.dirname || path.dirname(new URL(import.meta.url).pathname),
        '../../daemon/bin/concerto.mjs');
    if (fs.existsSync(sibling)) return sibling;
    return null;
}

async function autoSpawn() {
    const bin = findConcertoBin();
    if (!bin) {
        console.error(JSON.stringify({
            error: 'concerto binary not found on PATH and skill is not installed alongside the daemon',
            hint: 'install with `npm i -g concerto` or run from the source repo'
        }));
        process.exit(2);
    }
    fs.mkdirSync(CONCERTO_HOME, { recursive: true });
    const out = fs.openSync(LOG_FILE, 'a');
    const child = spawn(bin, ['daemon', 'start'], {
        detached: true,
        stdio: ['ignore', out, out],
    });
    child.unref();
    // wait up to 3s for the daemon to come up
    const start = Date.now();
    while (Date.now() - start < 3000) {
        await new Promise((r) => setTimeout(r, 150));
        const info = await probe();
        if (info) return info;
    }
    return null;
}

const existing = await probe();
const info = existing || (await autoSpawn());

if (!info) {
    console.error(JSON.stringify({
        error: 'daemon did not start',
        hint: `check ${LOG_FILE} or run \`concerto daemon logs\``,
    }));
    process.exit(1);
}

process.stdout.write(JSON.stringify({ port: info.port, token: info.token }) + '\n');
