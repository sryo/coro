'use client';

import { useState } from 'react';
import Link from 'next/link';
import type { Card, Stage, WorktreeStatus } from '@concerto/types';
import { StageSelect } from '@/components/stage-select';
import { TimeAgo } from '@/components/time-ago';

interface Props {
    card: Card;
    stages: Stage[];
    worktree: WorktreeStatus | null;
}

export function CardDetailHeader({ card: initialCard, stages, worktree }: Props) {
    const [card, setCard] = useState<Card>(initialCard);
    const currentStage = stages.find((s) => s.id === card.stage_id);

    return (
        <div className="px-6 pb-8 space-y-8">
            <h1 className="text-3xl font-bold leading-tight tracking-tight">{card.title}</h1>

            <div className="space-y-3">
                <StageSelect card={card} stages={stages} onUpdated={setCard} />
                {currentStage && (
                    <p className="text-xs text-[var(--muted-foreground)]">
                        {currentStage.kind === 'review'
                            ? 'Human review required to advance.'
                            : currentStage.kind === 'done'
                            ? 'Work complete. Use the merge endpoint to land it.'
                            : null}
                    </p>
                )}
            </div>

            {card.description && (
                <section>
                    <h2 className="text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)] mb-2">Description</h2>
                    <p className="text-sm whitespace-pre-wrap leading-relaxed">{card.description}</p>
                </section>
            )}

            <section>
                <h2 className="text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)] mb-2">Worktree</h2>
                {worktree && worktree.exists ? (
                    <dl className="space-y-2 text-sm">
                        <DefRow label="branch" value={worktree.branch} mono />
                        <DefRow label="base" value={`${worktree.base_branch} @ ${worktree.base_sha.slice(0, 7)}`} mono />
                        <DefRow label="diff" value={`+${worktree.ahead} / -${worktree.behind} · ${worktree.dirty_files} dirty`} />
                        {worktree.last_commit && (
                            <DefRow label="last commit" value={`${worktree.last_commit.sha.slice(0, 7)}  ${worktree.last_commit.subject}`} />
                        )}
                        <div className="pt-2">
                            <Link
                                href={`/p/${card.project_id}/c/${card.id}/diff`}
                                className="text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)] underline underline-offset-2"
                            >
                                view full diff →
                            </Link>
                        </div>
                    </dl>
                ) : (
                    <p className="text-sm text-[var(--muted-foreground)]">
                        No worktree yet. Move the card to an In Progress stage to create one.
                    </p>
                )}
            </section>

            <section>
                <h2 className="text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)] mb-2">Timeline</h2>
                <dl className="space-y-1 text-xs text-[var(--muted-foreground)]">
                    {card.started_at && <DefRowEl label="started"><TimeAgo ms={card.started_at} /></DefRowEl>}
                    {card.review_at && <DefRowEl label="review"><TimeAgo ms={card.review_at} /></DefRowEl>}
                    {card.done_at && <DefRowEl label="done"><TimeAgo ms={card.done_at} /></DefRowEl>}
                    {card.abandoned_at && <DefRowEl label="abandoned"><TimeAgo ms={card.abandoned_at} /></DefRowEl>}
                </dl>
            </section>
        </div>
    );
}

function DefRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
    return (
        <div className="flex gap-3">
            <dt className="w-20 shrink-0 text-xs uppercase tracking-wide text-[var(--muted-foreground)]">{label}</dt>
            <dd className={mono ? 'font-mono text-xs break-all' : 'text-sm'}>{value}</dd>
        </div>
    );
}

function DefRowEl({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <div className="flex gap-3">
            <dt className="w-20 shrink-0 text-xs uppercase tracking-wide text-[var(--muted-foreground)]">{label}</dt>
            <dd className="text-sm">{children}</dd>
        </div>
    );
}
