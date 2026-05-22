'use client';

import Link from 'next/link';
import type { Card, WorktreeBoardMeta } from '@coro/types';
import { TimeAgo } from '@/components/time-ago';

interface Props {
    projectId: string;
    card: Card;
    worktreeMeta?: WorktreeBoardMeta;
    streaming?: boolean;
    dragging?: boolean;
}

export function CardRow({ projectId, card, worktreeMeta, streaming, dragging }: Props) {
    const dirty = (worktreeMeta?.dirty_files ?? 0) > 0;
    const conflict = worktreeMeta?.merge_conflict_at != null;
    // Shout once: one badge wins. streaming > conflict > dirty. Rebase /
    // worktree-missing cues live on the card detail page now.
    const badge = streaming
        ? { color: 'bg-[var(--foreground)]', pulse: true, title: 'agent is mid-turn', label: 'streaming' }
        : conflict
            ? { color: 'bg-red-500', pulse: false, title: 'last merge attempt had conflicts', label: 'merge conflict' }
            : dirty
                ? { color: 'bg-orange-500', pulse: false, title: `worktree has ${worktreeMeta!.dirty_files} uncommitted file(s)`, label: 'dirty worktree' }
                : null;

    return (
        <Link
            href={`/p/${projectId}/c/${card.id}`}
            onClick={(e) => { if (dragging) e.preventDefault(); }}
            className={`block rounded-md border border-[var(--border)] bg-[var(--background)] p-4 hover:border-[var(--foreground)] ${dragging ? 'shadow-lg cursor-grabbing' : 'cursor-grab'}`}
        >
            <div className="flex items-start gap-2">
                {badge && (
                    <span
                        // WHY mt-1.5: optical alignment of the 8px dot with the first text line.
                        className={`mt-1.5 inline-block h-2 w-2 shrink-0 rounded-full ${badge.color} ${badge.pulse ? 'animate-pulse' : ''}`}
                        title={badge.title}
                        aria-label={badge.label}
                    />
                )}
                <div className="text-sm font-semibold leading-snug">{card.title}</div>
            </div>
            <div className="mt-2 flex items-baseline gap-3 text-xs text-[var(--muted-foreground)]">
                <span className="font-mono">{card.id.slice(0, 6)}</span>
                {card.branch_name && (
                    <span className="font-mono truncate">{card.branch_name.replace(/^coro\//, '')}</span>
                )}
            </div>
            <CardTimestamp card={card} />
        </Link>
    );
}

function CardTimestamp({ card }: { card: Card }) {
    const recent = pickRecentTimestamp(card);
    if (!recent) return null;
    return (
        <div className="mt-2 text-xs text-[var(--muted-foreground)]">
            {recent.label} <TimeAgo ms={recent.ms} />
        </div>
    );
}

function pickRecentTimestamp(card: Card): { label: string; ms: number } | null {
    if (card.abandoned_at) return { label: 'abandoned', ms: card.abandoned_at };
    if (card.merged_at) return { label: 'merged', ms: card.merged_at };
    if (card.done_at) return { label: 'done', ms: card.done_at };
    if (card.review_at) return { label: 'review', ms: card.review_at };
    if (card.started_at) return { label: 'started', ms: card.started_at };
    if (card.created_at) return { label: 'added', ms: card.created_at };
    return null;
}
