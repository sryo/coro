// Server-only fetch helpers used by Server Components for the initial render.
//
// Wraps @concerto/client.DaemonClient with a `getServerClient()` singleton.
// The Next dev server is long-lived, so one client per process is plenty.
// Read calls swallow daemon-down errors and return null so SSR pages render
// an empty state rather than 500ing.

import { DaemonClient } from '@concerto/client';

let cached: DaemonClient | null = null;

export function getServerClient(): DaemonClient {
    if (!cached) cached = new DaemonClient();
    return cached;
}

export async function serverGet<T>(path: string): Promise<T | null> {
    try {
        return await getServerClient().request<T>(path);
    } catch {
        return null;
    }
}

export async function serverGetText(path: string): Promise<string | null> {
    try {
        const client = getServerClient();
        const runtime = await client.ensureRunning({ spawn: false }).catch(() => null);
        if (!runtime) return null;
        const res = await fetch(runtime.base + path, {
            headers: { Authorization: `Bearer ${runtime.token}` },
            cache: 'no-store',
        });
        if (!res.ok) return null;
        return await res.text();
    } catch {
        return null;
    }
}
