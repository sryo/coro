import fs from 'fs';
import path from 'path';
import { CONCERTO_HOME, DEFAULT_API_PORT, getDb } from '@concerto/core';
import { startServer } from './server';
import { generateToken, writeDaemonInfo, clearDaemonInfo } from './auth';

const PID_FILE = path.join(CONCERTO_HOME, 'daemon.pid');

async function main() {
    fs.mkdirSync(CONCERTO_HOME, { recursive: true });

    getDb();

    const port = parseInt(process.env.CONCERTO_API_PORT || String(DEFAULT_API_PORT), 10);
    const token = generateToken();
    const startedAt = Date.now();

    const server = startServer({ port, token, startedAt });

    fs.writeFileSync(PID_FILE, String(process.pid));
    writeDaemonInfo({ port, token, pid: process.pid, started_at: startedAt });

    console.log(`[daemon] listening on http://localhost:${port}`);

    const shutdown = (signal: string) => {
        console.log(`[daemon] received ${signal}, shutting down`);
        server.close();
        try { fs.unlinkSync(PID_FILE); } catch {}
        clearDaemonInfo();
        process.exit(0);
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
    console.error('[daemon] fatal:', err);
    process.exit(1);
});
