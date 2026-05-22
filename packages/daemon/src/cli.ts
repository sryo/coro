import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { CONCERTO_HOME, DAEMON_INFO_FILE, LOG_FILE } from '@coro/core';
import { readDaemonInfo } from './auth';

const PID_FILE = path.join(CONCERTO_HOME, 'daemon.pid');
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RED = '\x1b[31m';
const DIM = '\x1b[2m';
const NC = '\x1b[0m';

function line(color: string, msg: string): void {
    process.stdout.write(`${color}${msg}${NC}\n`);
}

function isRunning(): number | null {
    if (!fs.existsSync(PID_FILE)) return null;
    const pid = parseInt(fs.readFileSync(PID_FILE, 'utf8').trim(), 10);
    if (!pid) return null;
    try {
        process.kill(pid, 0);
        return pid;
    } catch {
        try { fs.unlinkSync(PID_FILE); } catch {}
        return null;
    }
}

function daemonScript(): string {
    return path.resolve(__dirname, 'index.js');
}

async function waitForHealth(port: number, token: string, maxWait = 5000): Promise<boolean> {
    const start = Date.now();
    while (Date.now() - start < maxWait) {
        try {
            const res = await fetch(`http://localhost:${port}/health`, {
                headers: { Authorization: `Bearer ${token}` },
            });
            if (res.ok) return true;
        } catch {}
        await new Promise((r) => setTimeout(r, 150));
    }
    return false;
}

async function start(): Promise<void> {
    if (isRunning()) {
        line(YELLOW, 'concerto daemon already running');
        return;
    }
    fs.mkdirSync(CONCERTO_HOME, { recursive: true });
    const out = fs.openSync(LOG_FILE, 'a');
    const child = spawn('node', [daemonScript()], {
        detached: true,
        stdio: ['ignore', out, out],
        env: { ...process.env, CONCERTO_HOME },
    });
    child.unref();

    // wait briefly for daemon.json to appear, then health-check
    const startWait = Date.now();
    let info = null;
    while (Date.now() - startWait < 3000) {
        info = readDaemonInfo();
        if (info && info.pid === child.pid) break;
        await new Promise((r) => setTimeout(r, 80));
    }

    if (!info) {
        line(RED, 'daemon did not start');
        line(DIM, `  logs: ${LOG_FILE}`);
        process.exit(1);
    }

    const healthy = await waitForHealth(info.port, info.token);
    if (!healthy) {
        line(RED, 'daemon started but not responding');
        line(DIM, `  logs: ${LOG_FILE}`);
        process.exit(1);
    }

    line(GREEN, `concerto daemon started`);
    line(NC, `  pid    ${info.pid}`);
    line(NC, `  port   ${info.port}`);
    line(DIM, `  logs   ${LOG_FILE}`);
}

function stop(): void {
    const pid = isRunning();
    if (!pid) {
        line(YELLOW, 'concerto daemon not running');
        return;
    }
    try {
        process.kill(pid, 'SIGTERM');
        line(GREEN, `concerto daemon stopped (pid ${pid})`);
    } catch {
        line(YELLOW, 'process already exited');
    }
    try { fs.unlinkSync(PID_FILE); } catch {}
}

async function status(): Promise<void> {
    const pid = isRunning();
    if (!pid) {
        line(YELLOW, 'concerto daemon not running');
        return;
    }
    const info = readDaemonInfo();
    if (!info) {
        line(YELLOW, `daemon running (pid ${pid}) but daemon.json missing`);
        return;
    }
    try {
        const res = await fetch(`http://localhost:${info.port}/health`, {
            headers: { Authorization: `Bearer ${info.token}` },
        });
        const data = (await res.json()) as { uptime_ms?: number };
        const uptime = data.uptime_ms ? Math.floor(data.uptime_ms / 1000) : 0;
        line(GREEN, `concerto daemon running`);
        line(NC, `  pid    ${pid}`);
        line(NC, `  port   ${info.port}`);
        line(NC, `  uptime ${uptime}s`);
    } catch {
        line(YELLOW, `daemon running (pid ${pid}) but health check failed`);
    }
}

function logs(): void {
    if (!fs.existsSync(LOG_FILE)) {
        line(YELLOW, 'no log file yet');
        return;
    }
    const child = spawn('tail', ['-n', '200', '-f', LOG_FILE], { stdio: 'inherit' });
    process.on('SIGINT', () => child.kill('SIGINT'));
}

function printUsage(): void {
    line(NC, 'usage: concerto daemon <start|stop|status|logs>');
}

async function main() {
    const [, , cmd, sub] = process.argv;
    if (cmd !== 'daemon') {
        printUsage();
        process.exit(1);
    }
    switch (sub) {
        case 'start': await start(); break;
        case 'stop': stop(); break;
        case 'status': await status(); break;
        case 'logs': logs(); break;
        default: printUsage(); process.exit(1);
    }
}

main().catch((err) => {
    process.stderr.write(`${err?.stack || err}\n`);
    process.exit(1);
});
