import http from 'http';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { serve } from '@hono/node-server';
import { verifyAuth } from './auth';

export interface ServerOpts {
    port: number;
    token: string;
    startedAt: number;
}

export function startServer(opts: ServerOpts): http.Server {
    const app = new Hono();

    app.use('/*', cors());

    // Auth middleware — health is the only unauthenticated route.
    app.use('/*', async (c, next) => {
        if (c.req.path === '/health') return next();
        if (!verifyAuth(c.req.header('Authorization'), opts.token)) {
            return c.json({ error: { code: 'unauthorized', message: 'Missing or invalid bearer token' } }, 401);
        }
        await next();
    });

    app.get('/health', (c) => c.json({
        ok: true,
        version: '0.0.0',
        uptime_ms: Date.now() - opts.startedAt,
    }));

    app.notFound((c) => c.json({ error: { code: 'not_found', message: 'Not found' } }, 404));

    app.onError((err, c) => {
        console.error('[server]', err);
        return c.json({ error: { code: 'internal', message: 'Internal server error' } }, 500);
    });

    return serve({
        fetch: app.fetch,
        port: opts.port,
    }) as unknown as http.Server;
}
