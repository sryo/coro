// Server-side proxy from the dashboard to the daemon. The dashboard talks to
// /api/proxy/...; this route forwards to http://localhost:<daemon-port>/...
// with the bearer token from ~/.concerto/daemon.json. The token never reaches
// the browser.
//
// SSE: streams the upstream response body through to the client untouched.

import { NextRequest } from 'next/server';
import { daemonBase, daemonToken } from '@/lib/daemon';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function forward(req: NextRequest, params: { path: string[] }): Promise<Response> {
    const base = daemonBase();
    const token = daemonToken();
    if (!base || !token) {
        return Response.json({
            error: {
                code: 'daemon_unavailable',
                message: 'concerto daemon is not running',
                hint: 'run `concerto daemon start` from a terminal',
            },
        }, { status: 503 });
    }

    const subpath = '/' + params.path.join('/');
    const queryString = req.nextUrl.search;
    const url = base + subpath + queryString;

    const headers: Record<string, string> = {
        Authorization: `Bearer ${token}`,
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
