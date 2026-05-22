// Server-side proxy from the dashboard to the daemon. The browser talks to
// /api/proxy/...; this route forwards to http://localhost:<daemon-port>/...
// with the bearer token from ~/.coro/daemon.json. The token never reaches
// the browser.
//
// Non-SSE: delegates to DaemonClient.request via getServerClient(). SSE: pipes
// the upstream body through untouched so EventSource sees frames as they
// arrive. The proxy validates the target path stays under the daemon (no
// path traversal, no absolute URLs).

import { NextRequest } from 'next/server';
import { getServerClient } from '@/lib/server-api';
import { buildSubpath } from '../build-subpath';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function forward(req: NextRequest, params: { path: string[] }): Promise<Response> {
    const client = getServerClient();
    let runtime;
    try {
        runtime = await client.ensureRunning({ spawn: false });
    } catch {
        return Response.json({
            error: {
                code: 'daemon_unavailable',
                message: 'coro daemon is not running',
                hint: 'run `coro daemon start` from a terminal',
            },
        }, { status: 503 });
    }

    const subpath = buildSubpath(params.path);
    if (subpath === null) {
        return Response.json({
            error: { code: 'bad_request', message: 'invalid proxy path' },
        }, { status: 400 });
    }
    const url = runtime.base + subpath + req.nextUrl.search;

    const headers: Record<string, string> = {
        Authorization: `Bearer ${runtime.token}`,
    };
    const contentType = req.headers.get('content-type');
    if (contentType) headers['Content-Type'] = contentType;
    const accept = req.headers.get('accept');
    if (accept) headers['Accept'] = accept;

    const body = (req.method !== 'GET' && req.method !== 'HEAD') ? await req.text() : undefined;

    const upstream = await fetch(url, {
        method: req.method,
        headers,
        body,
        cache: 'no-store',
        // Don't decode SSE — pipe raw bytes.
        // @ts-expect-error node fetch supports this
        duplex: body ? 'half' : undefined,
    });

    const responseHeaders = new Headers();
    upstream.headers.forEach((v, k) => responseHeaders.set(k, v));

    return new Response(upstream.body, {
        status: upstream.status,
        statusText: upstream.statusText,
        headers: responseHeaders,
    });
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) { return forward(req, await ctx.params); }
export async function POST(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) { return forward(req, await ctx.params); }
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) { return forward(req, await ctx.params); }
export async function PUT(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) { return forward(req, await ctx.params); }
export async function DELETE(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) { return forward(req, await ctx.params); }
