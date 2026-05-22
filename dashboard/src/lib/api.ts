// Browser-side API client. Hits the local Next proxy, which forwards to the
// daemon with the bearer token (token never leaves the server).
//
// SSE: opens an EventSource against the proxy and wraps it with reconnect +
// heartbeat logic. The proxy pipes the daemon's stream through unchanged, so
// the wire format is the daemon's SSE.

interface RequestError extends Error {
    status: number;
    body: unknown;
}

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
        const err = new Error(extractMessage(json) || `HTTP ${res.status}`) as RequestError;
        err.status = res.status;
        err.body = json;
        throw err;
    }
    return json as T;
}

function safeJson(text: string): unknown {
    try { return JSON.parse(text); } catch { return text; }
}

function extractMessage(body: unknown): string | null {
    if (body && typeof body === 'object' && 'error' in body) {
        const err = (body as { error: unknown }).error;
        if (err && typeof err === 'object' && 'message' in err && typeof (err as { message: unknown }).message === 'string') {
            return (err as { message: string }).message;
        }
    }
    return null;
}

export const api = {
    get: <T>(p: string) => call<T>('GET', p),
    post: <T>(p: string, body?: unknown) => call<T>('POST', p, body ?? {}),
    patch: <T>(p: string, body?: unknown) => call<T>('PATCH', p, body ?? {}),
    put: <T>(p: string, body?: unknown) => call<T>('PUT', p, body ?? {}),
    delete: <T>(p: string) => call<T>('DELETE', p),
};

// Events the daemon emits that the dashboard cares about. Adding to this set
// is harmless — unknown event names still flow through the underlying ES
// onmessage path.
const KNOWN_EVENTS = [
    'connected',
    'heartbeat',
    'card:created',
    'card:deleted',
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
    'card:worktree_changed',
    'worktree:created',
    'worktree:removed',
];

const RECONNECT_MIN_MS = 500;
const RECONCONNECT_MAX_MS = 30_000;
const HEARTBEAT_TIMEOUT_MS = 60_000;

export interface StreamHandle {
    close(): void;
}

export function openStream(cardId: string, onEvent: (type: string, data: any) => void): StreamHandle {
    return openRobustStream(`/api/proxy/cards/${cardId}/stream`, onEvent);
}

export function openProjectStream(projectId: string, onEvent: (type: string, data: any) => void): StreamHandle {
    return openRobustStream(`/api/proxy/projects/${projectId}/stream`, onEvent);
}

export function openCardStream(cardId: string, onEvent: (type: string, data: any) => void): StreamHandle {
    return openStream(cardId, onEvent);
}

// EventSource with auto-reconnect + heartbeat watchdog. If the underlying ES
// errors or no event arrives within HEARTBEAT_TIMEOUT_MS, we tear down and
// reconnect with exponential backoff capped at RECONNECT_MAX_MS.
function openRobustStream(url: string, onEvent: (type: string, data: any) => void): StreamHandle {
    let es: EventSource | null = null;
    let closed = false;
    let backoff = RECONNECT_MIN_MS;
    let watchdog: ReturnType<typeof setTimeout> | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    const resetWatchdog = () => {
        if (watchdog) clearTimeout(watchdog);
        watchdog = setTimeout(() => { reconnect(); }, HEARTBEAT_TIMEOUT_MS);
    };

    const teardown = () => {
        if (watchdog) { clearTimeout(watchdog); watchdog = null; }
        if (es) {
            try { es.close(); } catch {}
            es = null;
        }
    };

    const reconnect = () => {
        if (closed) return;
        teardown();
        const wait = backoff;
        backoff = Math.min(backoff * 2, RECONCONNECT_MAX_MS);
        reconnectTimer = setTimeout(connect, wait);
    };

    const connect = () => {
        if (closed) return;
        reconnectTimer = null;
        es = new EventSource(url);
        es.onopen = () => {
            backoff = RECONNECT_MIN_MS;
            resetWatchdog();
        };
        es.onerror = () => { reconnect(); };
        const dispatch = (e: MessageEvent) => {
            resetWatchdog();
            try { onEvent(e.type, JSON.parse(e.data)); } catch { /* keep going */ }
        };
        for (const t of KNOWN_EVENTS) {
            es.addEventListener(t, dispatch);
        }
    };

    connect();

    return {
        close: () => {
            closed = true;
            if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
            teardown();
        },
    };
}
