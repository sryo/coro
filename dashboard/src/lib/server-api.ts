// Server-only fetch helpers for use in Server Components (initial render).
import { daemonBase, daemonToken } from './daemon';

export async function serverGet<T>(path: string): Promise<T | null> {
    const base = daemonBase();
    const token = daemonToken();
    if (!base || !token) return null;
    try {
        const res = await fetch(base + path, {
            headers: { Authorization: `Bearer ${token}` },
            cache: 'no-store',
        });
        if (!res.ok) return null;
        return (await res.json()) as T;
    } catch {
        return null;
    }
}

export async function serverGetText(path: string): Promise<string | null> {
    const base = daemonBase();
    const token = daemonToken();
    if (!base || !token) return null;
    try {
        const res = await fetch(base + path, {
            headers: { Authorization: `Bearer ${token}` },
            cache: 'no-store',
        });
        if (!res.ok) return null;
        return await res.text();
    } catch {
        return null;
    }
}
