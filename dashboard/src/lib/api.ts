// Browser-side API client. Hits the local Next proxy, which forwards to the daemon
// with the bearer token (token never leaves the server).

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(`/api/proxy${path.startsWith('/') ? path : '/' + path}`, {
        method,
        headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        cache: 'no-store',
    });
    const text = await res.text();
    const json = text ? safeJson(text) : null;
    if (!res.ok) {
        const err: any = new Error(json?.error?.message || `HTTP ${res.status}`);
        err.status = res.status;
        err.body = json;
        throw err;
    }
    return json as T;
}

function safeJson(text: string): any {
    try { return JSON.parse(text); } catch { return text; }
}

export const api = {
    get: <T>(p: string) => call<T>('GET', p),
    post: <T>(p: string, body?: unknown) => call<T>('POST', p, body ?? {}),
    patch: <T>(p: string, body?: unknown) => call<T>('PATCH', p, body ?? {}),
    put: <T>(p: string, body?: unknown) => call<T>('PUT', p, body ?? {}),
    delete: <T>(p: string) => call<T>('DELETE', p),
};

// SSE: connect to the proxy's SSE relay. Returns an EventSource the caller can close().
export function openStream(cardId: string, onEvent: (type: string, data: any) => void): EventSource {
    return openEventSource(`/api/proxy/cards/${cardId}/stream`, onEvent);
}

export function openProjectStream(projectId: string, onEvent: (type: string, data: any) => void): EventSource {
    return openEventSource(`/api/proxy/projects/${projectId}/stream`, onEvent);
}

function openEventSource(url: string, onEvent: (type: string, data: any) => void): EventSource {
    const es = new EventSource(url);
    const types = [
        'connected',
        'card:message',
        'card:turn_started',
        'card:text_stream',
        'card:turn_complete',
        'card:turn_failed',
        'card:usage',
        'card:error',
        'card:stage_changed',
        'card:note',
        'card:abandoned',
        'card:merged',
        'worktree:removed',
    ];
    for (const t of types) {
        es.addEventListener(t, (e: MessageEvent) => {
            try { onEvent(t, JSON.parse(e.data)); } catch {}
        });
    }
    return es;
}
