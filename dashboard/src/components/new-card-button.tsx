'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import type { Card } from '@concerto/types';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';

interface Props {
    projectId: string;
}

export function NewCardButton({ projectId }: Props) {
    const [open, setOpen] = useState(false);
    const [title, setTitle] = useState('');
    const [description, setDescription] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const router = useRouter();
    const titleRef = useRef<HTMLInputElement>(null);

    function close() {
        setOpen(false);
        setTitle('');
        setDescription('');
        setError(null);
    }

    async function create() {
        if (!title.trim() || busy) return;
        setBusy(true);
        setError(null);
        try {
            await api.post<Card>(`/projects/${projectId}/cards`, {
                title: title.trim(),
                description: description.trim() || undefined,
            });
            close();
            router.refresh();
        } catch (err: any) {
            setError(err.body?.error?.message || err.message);
        } finally {
            setBusy(false);
        }
    }

    if (!open) {
        return (
            <Button
                variant="subtle"
                size="sm"
                onClick={() => {
                    setOpen(true);
                    setTimeout(() => titleRef.current?.focus(), 0);
                }}
            >
                + New card
            </Button>
        );
    }

    return (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/30 px-4 pt-24" onClick={close}>
            <div
                className="w-full max-w-lg rounded-lg border border-[var(--border)] bg-[var(--background)] p-6 shadow-xl"
                onClick={(e) => e.stopPropagation()}
            >
                <h2 className="text-lg font-bold mb-4">New card</h2>
                <input
                    ref={titleRef}
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="Title"
                    className="w-full rounded-md border border-[var(--border)] bg-transparent px-3 py-2 text-sm focus:outline-none focus:border-[var(--foreground)]"
                    onKeyDown={(e) => {
                        if (e.key === 'Escape') close();
                        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) create();
                    }}
                />
                <div className="mt-3">
                    <Textarea
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                        placeholder="Description (optional, markdown)"
                        rows={4}
                        onKeyDown={(e) => {
                            if (e.key === 'Escape') close();
                            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) create();
                        }}
                    />
                </div>
                {error && <p className="mt-3 text-xs text-[var(--muted-foreground)]">{error}</p>}
                <div className="mt-5 flex items-center justify-between">
                    <span className="text-xs text-[var(--muted-foreground)]">⌘↵ to create · esc to cancel</span>
                    <div className="flex gap-2">
                        <Button variant="ghost" size="sm" onClick={close} disabled={busy}>Cancel</Button>
                        <Button size="sm" onClick={create} disabled={busy || !title.trim()}>
                            {busy ? 'Creating…' : 'Create'}
                        </Button>
                    </div>
                </div>
            </div>
        </div>
    );
}
