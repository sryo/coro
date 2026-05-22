'use client';

import { useState } from 'react';
import { api } from '@/lib/api';
import type { Card, Stage } from '@coro/types';
import { useSelection } from '@/components/card-selection-context';

interface Props {
    cards: Card[];
    stages: Stage[];
}

type Pending = null | 'delete' | 'abandon';

export function CardActionsBar({ cards, stages }: Props) {
    const ctx = useSelection();
    const [pending, setPending] = useState<Pending>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    if (!ctx || ctx.count === 0) return null;
    const selection = ctx;

    const selectedCards = cards.filter((c) => selection.has(c.id));
    const backlogStageIds = new Set(stages.filter((s) => s.kind === 'backlog').map((s) => s.id));
    const deletable = selectedCards.filter((c) => backlogStageIds.has(c.stage_id));
    const abandonable = selectedCards.filter((c) => !backlogStageIds.has(c.stage_id));

    async function fanOut(ids: string[], op: (id: string) => Promise<void>): Promise<{ failed: number }> {
        setBusy(true);
        setError(null);
        const results = await Promise.allSettled(ids.map(op));
        setBusy(false);
        const failed = results.filter((r) => r.status === 'rejected').length;
        if (failed > 0) {
            const first = results.find((r) => r.status === 'rejected') as PromiseRejectedResult | undefined;
            setError(`${failed} of ${ids.length} failed${first ? `: ${first.reason?.message ?? first.reason}` : ''}`);
        }
        return { failed };
    }

    async function move(toStageId: string) {
        await fanOut(selectedCards.map((c) => c.id), async (id) => {
            await api.post(`/cards/${id}/transitions`, { to_stage_id: toStageId, actor: 'user' });
        });
        selection.clear();
    }

    async function confirmDelete() {
        await fanOut(deletable.map((c) => c.id), async (id) => { await api.delete(`/cards/${id}`); });
        setPending(null);
        selection.clear();
    }

    async function confirmAbandon() {
        await fanOut(abandonable.map((c) => c.id), async (id) => {
            await api.post(`/cards/${id}/abandon`, { stash_dirty: true, actor: 'user' });
        });
        setPending(null);
        selection.clear();
    }

    return (
        <div className="pointer-events-none fixed inset-x-0 bottom-6 z-40 flex justify-center">
            <div className="pointer-events-auto flex items-center gap-4 rounded-md border border-[var(--border)] bg-[var(--background)] px-4 py-2 text-sm shadow-[0_4px_12px_rgba(0,0,0,0.08)]">
                <span className="text-[var(--muted-foreground)]">
                    {selection.count} {selection.count === 1 ? 'card' : 'cards'}
                </span>
                <Sep />
                {pending === null && (
                    <>
                        <MoveMenu stages={stages} onMove={move} disabled={busy} />
                        {deletable.length > 0 && (
                            <button
                                type="button"
                                disabled={busy}
                                onClick={() => setPending('delete')}
                                className="hover:underline"
                            >
                                delete {deletable.length}
                            </button>
                        )}
                        {abandonable.length > 0 && (
                            <button
                                type="button"
                                disabled={busy}
                                onClick={() => setPending('abandon')}
                                className="hover:underline"
                            >
                                abandon {abandonable.length}
                            </button>
                        )}
                        <Sep />
                        <button
                            type="button"
                            onClick={() => selection.clear()}
                            className="text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
                        >
                            clear
                        </button>
                    </>
                )}
                {pending === 'delete' && (
                    <ConfirmRow
                        label={`Delete ${deletable.length} ${deletable.length === 1 ? 'card' : 'cards'}?`}
                        busy={busy}
                        onConfirm={confirmDelete}
                        onCancel={() => setPending(null)}
                    />
                )}
                {pending === 'abandon' && (
                    <ConfirmRow
                        label={`Abandon ${abandonable.length} ${abandonable.length === 1 ? 'card' : 'cards'} (stash dirty work)?`}
                        busy={busy}
                        onConfirm={confirmAbandon}
                        onCancel={() => setPending(null)}
                    />
                )}
                {error && (
                    <span className="ml-2 text-xs text-[var(--muted-foreground)]">{error}</span>
                )}
            </div>
        </div>
    );
}

function Sep() {
    return <span className="text-[var(--muted-foreground)]">·</span>;
}

function ConfirmRow({
    label, busy, onConfirm, onCancel,
}: {
    label: string;
    busy: boolean;
    onConfirm: () => void | Promise<void>;
    onCancel: () => void;
}) {
    return (
        <>
            <span className="text-[var(--muted-foreground)]">{label}</span>
            <button
                type="button"
                disabled={busy}
                onClick={onConfirm}
                className="font-semibold hover:underline"
            >
                {busy ? 'working…' : 'remove'}
            </button>
            <button
                type="button"
                disabled={busy}
                onClick={onCancel}
                className="text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
            >
                cancel
            </button>
        </>
    );
}

function MoveMenu({
    stages, onMove, disabled,
}: {
    stages: Stage[];
    onMove: (id: string) => Promise<void>;
    disabled: boolean;
}) {
    const [open, setOpen] = useState(false);
    if (!open) {
        return (
            <button
                type="button"
                disabled={disabled}
                onClick={() => setOpen(true)}
                className="hover:underline"
            >
                move to…
            </button>
        );
    }
    return (
        <select
            autoFocus
            defaultValue=""
            disabled={disabled}
            onBlur={() => setOpen(false)}
            onChange={(e) => {
                if (e.target.value) onMove(e.target.value);
                setOpen(false);
            }}
            className="bg-transparent text-sm focus:outline-none"
        >
            <option value="" disabled>pick stage</option>
            {stages.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
            ))}
        </select>
    );
}
