'use client';

import { useState } from 'react';
import { api } from '@/lib/api';
import type { Card, Stage } from '@concerto/types';

interface Props {
    card: Card;
    stages: Stage[];
    onUpdated: (card: Card) => void;
}

export function StageSelect({ card, stages, onUpdated }: Props) {
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    async function transition(toStageId: string) {
        if (toStageId === card.stage_id) return;
        setBusy(true);
        setError(null);
        try {
            const updated = await api.post<Card>(`/cards/${card.id}/transitions`, {
                to_stage_id: toStageId,
                actor: 'user',
            });
            onUpdated(updated);
        } catch (err: any) {
            const allowed = err.body?.error?.allowed as string[] | undefined;
            if (allowed && allowed.length > 0) {
                try {
                    const updated = await api.post<Card>(`/cards/${card.id}/transitions`, {
                        to_stage_id: allowed[0],
                        actor: 'user',
                    });
                    onUpdated(updated);
                    return;
                } catch (err2: any) {
                    setError(err2.message);
                }
            } else {
                setError(err.message);
            }
        } finally {
            setBusy(false);
        }
    }

    return (
        <div>
            <select
                className="rounded-md border border-[var(--border)] bg-transparent px-3 py-1.5 text-sm focus:outline-none focus:border-[var(--foreground)]"
                value={card.stage_id}
                disabled={busy}
                onChange={(e) => transition(e.target.value)}
            >
                {stages.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                ))}
            </select>
            {error && <p className="mt-2 text-xs text-[var(--muted-foreground)]">{error}</p>}
        </div>
    );
}
