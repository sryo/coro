'use client';

import { useEffect, useRef, useState } from 'react';

interface Props {
    onAdd: (name: string) => Promise<void> | void;
}

export function AddStageSlot({ onAdd }: Props) {
    const [editing, setEditing] = useState(false);
    const [name, setName] = useState('');
    const [busy, setBusy] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (editing) inputRef.current?.focus();
    }, [editing]);

    function reset() {
        setEditing(false);
        setName('');
    }

    async function submit() {
        const value = name.trim();
        if (!value || busy) return;
        setBusy(true);
        try {
            await onAdd(value);
            reset();
        } finally {
            setBusy(false);
        }
    }

    if (!editing) {
        return (
            <button
                type="button"
                onClick={() => setEditing(true)}
                className="group/empty flex flex-col w-72 shrink-0 h-full rounded-lg p-4 border-2 border-dashed border-[var(--border)] text-left hover:border-[var(--foreground)] transition-colors"
            >
                <span className="text-sm font-semibold tracking-tight text-[var(--muted-foreground)] group-hover/empty:text-[var(--foreground)]">
                    + add stage
                </span>
                <span className="flex-1" />
            </button>
        );
    }

    return (
        <section className="flex flex-col w-72 shrink-0 h-full rounded-lg p-4 border-2 border-dashed border-[var(--foreground)]">
            <header className="mb-4 flex items-baseline gap-2">
                <input
                    ref={inputRef}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    onBlur={() => { if (!name.trim() && !busy) reset(); }}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter') { e.preventDefault(); submit(); }
                        if (e.key === 'Escape') { e.preventDefault(); reset(); }
                    }}
                    placeholder="Stage name"
                    disabled={busy}
                    className="flex-1 bg-[var(--muted)] -mx-1 px-1 rounded-sm text-sm font-semibold tracking-tight focus:outline-none"
                />
            </header>
            <div className="flex-1" />
        </section>
    );
}
