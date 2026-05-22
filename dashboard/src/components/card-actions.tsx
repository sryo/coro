'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import type { Card, Stage } from '@coro/types';
import { Button } from '@/components/ui/button';
import { StageSelect } from '@/components/stage-select';

interface Props {
    card: Card;
    stages: Stage[];
}

export function CardActions({ card: initialCard, stages }: Props) {
    const router = useRouter();
    const [card, setCard] = useState<Card>(initialCard);
    const [busy, setBusy] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [notice, setNotice] = useState<string | null>(null);

    const [mergeOpen, setMergeOpen] = useState(false);
    const [commitMessage, setCommitMessage] = useState(card.title);
    const [conflicts, setConflicts] = useState<string[] | null>(null);

    const currentStage = stages.find((s) => s.id === card.stage_id);
    const doneStage = stages.find((s) => s.kind === 'done');
    const inProgressStage = stages.find((s) => s.kind === 'active');
    const hasWorktree = !!card.worktree_path;
    const inReview = currentStage?.kind === 'review';
    const inDone = currentStage?.kind === 'done';
    const inBacklog = currentStage?.kind === 'backlog';
    const archived = currentStage?.kind === 'archive' || currentStage?.kind === 'abandoned' || !!card.abandoned_at;
    const statusLine = inReview
        ? 'Move it forward when reviewed.'
        : inDone
            ? 'Run /coro-merge or click Merge to land it.'
            : null;

    async function performMerge() {
        setBusy('merge');
        setError(null);
        setNotice(null);
        setConflicts(null);
        try {
            const body: any = { commit_message: commitMessage.trim() || card.title };
            await api.post(`/cards/${card.id}/merge`, body);
            setNotice('merged');
            setMergeOpen(false);
            router.refresh();
        } catch (err: any) {
            const errBody = err.body?.error;
            if (errBody?.code === 'conflict' && Array.isArray(errBody.conflicts)) {
                setConflicts(errBody.conflicts);
            } else {
                setError(errBody?.message || err.message);
            }
        } finally {
            setBusy(null);
        }
    }

    async function run(label: string, fn: () => Promise<unknown>) {
        setBusy(label);
        setError(null);
        setNotice(null);
        try {
            await fn();
            setNotice(`${label} ok`);
            router.refresh();
        } catch (err: any) {
            setError(err.body?.error?.message || err.message);
        } finally {
            setBusy(null);
        }
    }

    async function performDelete() {
        if (!confirm('Delete this card? This cannot be undone.')) return;
        setBusy('delete');
        setError(null);
        try {
            await api.delete(`/cards/${card.id}`);
            router.push(`/p/${card.project_id}`);
        } catch (err: any) {
            setError(err.body?.error?.message || err.message);
            setBusy(null);
        }
    }

    return (
        <section className="space-y-4">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">Actions</h2>

            <StageSelect card={card} stages={stages} onUpdated={setCard} />
            {statusLine && (
                <p className="text-xs text-[var(--muted-foreground)]">{statusLine}</p>
            )}

            {archived ? (
                <p className="text-xs text-[var(--muted-foreground)]">
                    {card.abandoned_at ? 'Card abandoned.' : 'Card merged.'} No further actions.
                </p>
            ) : (
                <div className="flex flex-wrap gap-2">
                    {inDone && (
                        <Button
                            size="sm"
                            disabled={!!busy}
                            onClick={() => setMergeOpen((o) => !o)}
                        >
                            {mergeOpen ? 'Cancel merge' : 'Merge into base'}
                        </Button>
                    )}
                    {inReview && doneStage && (
                        <Button
                            size="sm"
                            disabled={!!busy}
                            onClick={() =>
                                run('approve', () =>
                                    api.post(`/cards/${card.id}/transitions`, {
                                        to_stage_id: doneStage.id,
                                        actor: 'user',
                                        reason: 'approved from review',
                                    }),
                                )
                            }
                        >
                            {busy === 'approve' ? 'Approving…' : 'Approve → Done'}
                        </Button>
                    )}
                    {inReview && inProgressStage && (
                        <Button
                            size="sm"
                            variant="subtle"
                            disabled={!!busy}
                            onClick={() =>
                                run('send back', () =>
                                    api.post(`/cards/${card.id}/transitions`, {
                                        to_stage_id: inProgressStage.id,
                                        actor: 'user',
                                        reason: 'sent back from review',
                                    }),
                                )
                            }
                        >
                            {busy === 'send back' ? 'Sending…' : 'Send back to In Progress'}
                        </Button>
                    )}
                    {hasWorktree && (
                        <Button
                            size="sm"
                            variant="ghost"
                            disabled={!!busy}
                            onClick={() => run('interrupt', () => api.post(`/cards/${card.id}/interrupt`))}
                        >
                            {busy === 'interrupt' ? '…' : 'Interrupt'}
                        </Button>
                    )}
                    {inBacklog ? (
                        <Button
                            size="sm"
                            variant="ghost"
                            disabled={!!busy}
                            onClick={performDelete}
                        >
                            {busy === 'delete' ? 'Deleting…' : 'Delete'}
                        </Button>
                    ) : (
                        <Button
                            size="sm"
                            variant="ghost"
                            disabled={!!busy}
                            onClick={() => {
                                if (!confirm('Abandon this card? Dirty work will be stashed.')) return;
                                run('abandon', () => api.post(`/cards/${card.id}/abandon`, { stash_dirty: true }));
                            }}
                        >
                            {busy === 'abandon' ? 'Abandoning…' : 'Abandon'}
                        </Button>
                    )}
                </div>
            )}

            {mergeOpen && inDone && (
                <div className="mt-4 space-y-3 rounded-md border border-[var(--border)] p-3">
                    <label className="block text-xs uppercase tracking-wide text-[var(--muted-foreground)]">
                        Commit message
                    </label>
                    <input
                        value={commitMessage}
                        onChange={(e) => setCommitMessage(e.target.value)}
                        className="w-full rounded-md border border-[var(--border)] bg-transparent px-3 py-1.5 text-sm focus:outline-none focus:border-[var(--foreground)]"
                    />
                    <div className="flex items-center justify-between">
                        <span className="text-xs text-[var(--muted-foreground)]">Squash merge into base branch.</span>
                        <Button size="sm" onClick={performMerge} disabled={!!busy || !commitMessage.trim()}>
                            {busy === 'merge' ? 'Merging…' : 'Merge'}
                        </Button>
                    </div>
                    {conflicts && conflicts.length > 0 && (
                        <div className="rounded-md border border-[var(--border)] p-2">
                            <p className="text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)] mb-1">
                                Conflicts
                            </p>
                            <ul className="font-mono text-xs space-y-0.5">
                                {conflicts.map((f) => <li key={f}>{f}</li>)}
                            </ul>
                            <p className="mt-2 text-xs text-[var(--muted-foreground)]">
                                Resolve in the worktree, commit, then retry.
                            </p>
                        </div>
                    )}
                </div>
            )}

            {error && <p className="text-xs text-[var(--muted-foreground)]">{error}</p>}
            {notice && !error && <p className="text-xs text-[var(--muted-foreground)]">{notice}</p>}
        </section>
    );
}
