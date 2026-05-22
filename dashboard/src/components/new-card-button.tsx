'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import type { Card } from '@coro/types';

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
    const inputRef = useRef<HTMLTextAreaElement>(null);

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
                className="sticky-fold block w-full bg-[#ffd000] text-[#3a2d0a] px-4 py-3 text-left text-xs hover:opacity-95"
            >
                + new card
            </button>
        );
    }

    return (
        <div className="sticky-fold bg-[#ffd000] text-[#3a2d0a] p-4">
            <textarea
                ref={inputRef}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                onBlur={() => { if (title.trim()) submit(); else reset(); }}
                onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); }
                    if (e.key === 'Escape') { e.preventDefault(); reset(); }
                }}
                placeholder="card title"
                disabled={busy}
                rows={1}
                className="w-full resize-none bg-transparent text-sm font-semibold leading-snug placeholder:font-normal placeholder:opacity-60 focus:outline-none [field-sizing:content]"
            />
            {error && <p className="mt-2 text-xs opacity-60">{error}</p>}
        </div>
    );
}
