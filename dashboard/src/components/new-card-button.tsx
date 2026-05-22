'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import type { Card } from '@concerto/types';

interface Props {
    projectId: string;
}

// Inline form that lives at the bottom of the Backlog column. Click "+ new card"
// to reveal an input. Enter submits, Escape cancels. No modal, no dimmed bg.
export function InlineNewCardForm({ projectId }: Props) {
    const [editing, setEditing] = useState(false);
    const [title, setTitle] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const router = useRouter();
    const inputRef = useRef<HTMLInputElement>(null);

    function reset() {
        setEditing(false);
        setTitle('');
        setError(null);
    }

    async function submit() {
        const value = title.trim();
        if (!value || busy) return;
        setBusy(true);
        setError(null);
        try {
            await api.post<Card>(`/projects/${projectId}/cards`, { title: value });
            setTitle('');
            // Keep editing open so the user can chain entries; refresh pulls in
            // the new card via SSR (SSE will also surface it once that exists).
            router.refresh();
            setTimeout(() => inputRef.current?.focus(), 0);
        } catch (err: any) {
            setError(err.body?.error?.message || err.message);
        } finally {
            setBusy(false);
        }
    }

    if (!editing) {
        return (
            <button
                type="button"
                onClick={() => {
                    setEditing(true);
                    setTimeout(() => inputRef.current?.focus(), 0);
                }}
                className="block w-full rounded-md border border-dashed border-[var(--border)] px-4 py-3 text-left text-xs text-[var(--muted-foreground)] hover:border-[var(--foreground)] hover:text-[var(--foreground)]"
            >
                + new card
            </button>
        );
    }

    return (
        <div className="rounded-md border border-[var(--border)] bg-[var(--background)] p-4">
            <input
                ref={inputRef}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                onBlur={() => { if (!title.trim()) reset(); }}
                onKeyDown={(e) => {
                    if (e.key === 'Enter') { e.preventDefault(); submit(); }
                    if (e.key === 'Escape') { e.preventDefault(); reset(); }
                }}
                placeholder="card title"
                disabled={busy}
                className="w-full bg-transparent text-sm font-semibold leading-snug placeholder:font-normal placeholder:text-[var(--muted-foreground)] focus:outline-none"
            />
            {error && <p className="mt-2 text-xs text-[var(--muted-foreground)]">{error}</p>}
        </div>
    );
}
