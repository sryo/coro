'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import type { Card, StageKind, WorktreeBoardMeta } from '@coro/types';
import { TimeAgo } from '@/components/time-ago';
import { InlineText } from '@/components/inline-edit';
import { useSelection } from '@/components/card-selection-context';
import { cn } from '@/lib/utils';

interface Props {
    projectId: string;
    card: Card;
    stageKind?: StageKind;
    worktreeMeta?: WorktreeBoardMeta;
    streaming?: boolean;
    dragging?: boolean;
}

export function CardRow({ projectId, card, stageKind, worktreeMeta, streaming, dragging }: Props) {
    const router = useRouter();
    const selection = useSelection();
    const selected = selection?.has(card.id) ?? false;
    const [editing, setEditing] = useState(false);
    const [optimisticTitle, setOptimisticTitle] = useState<string | null>(null);

    const dirty = (worktreeMeta?.dirty_files ?? 0) > 0;
    const conflict = worktreeMeta?.merge_conflict_at != null;
    // Selection wins the left rule (the one strong move). Status colours stay flat
    // and saturated when the card is unselected; when both are true, the accent
    // outline carries selection and the warning still reads in the side rule.
    const leftRule = selected
        ? 'border-l-2 border-[var(--accent)]'
        : streaming
            ? 'border-l-2 border-[var(--foreground)] animate-pulse'
            : conflict
                ? 'border-l-2 border-red-500'
                : dirty
                    ? 'border-l-2 border-orange-500'
                    : '';

    const wantsAttention = stageKind === 'review';
    const titleClass = wantsAttention
        ? 'text-base font-bold leading-snug'
        : 'text-sm font-semibold leading-snug';

    const surfaceClass = cn(
        'block bg-[#ffd000] text-[#3a2d0a] p-4',
        leftRule,
        selected && 'ring-2 ring-[var(--accent)]',
        dragging
            ? 'shadow-xl cursor-grabbing animate-[lift-rotate_150ms_ease-out_forwards]'
            : 'cursor-grab',
    );

    async function rename(title: string) {
        setOptimisticTitle(title);
        try {
            await api.patch(`/cards/${card.id}`, { title });
            setEditing(false);
            router.refresh();
        } catch {
            setOptimisticTitle(null);
        }
    }

    const title = optimisticTitle ?? card.title;

    if (editing) {
        return (
            <div className={surfaceClass} onPointerDown={(e) => e.stopPropagation()}>
                <div className={titleClass}>
                    <InlineText
                        value={title}
                        autoEdit
                        placeholder="Card title"
                        onSubmit={rename}
                        onCancel={() => setEditing(false)}
                    />
                </div>
                <CardMeta card={card} title={title} />
            </div>
        );
    }

    function onClick(e: React.MouseEvent) {
        if (dragging) { e.preventDefault(); return; }
        if (selection && (e.metaKey || e.ctrlKey || e.shiftKey)) {
            e.preventDefault();
            selection.toggle(card.id);
        }
    }

    return (
        <Link
            href={`/p/${projectId}/c/${card.id}`}
            onClick={onClick}
            className={cn(surfaceClass, 'group/card')}
        >
            <div
                className={cn(titleClass, 'cursor-text rounded-sm -mx-1 px-1 break-words hover:bg-[color-mix(in_srgb,var(--foreground)_6%,transparent)]')}
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); setEditing(true); }}
            >
                {title}
            </div>
            <CardMeta card={card} title={title} />
        </Link>
    );
}

function CardMeta({ card, title, children }: { card: Card; title: string; children?: React.ReactNode }) {
    const recent = pickRecentTimestamp(card);
    const branch = card.branch_name?.replace(/^coro\//, '');
    if (!recent && !branch && !children) return null;
    void title;
    return (
        <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1 text-xs opacity-60">
            {branch && <span className="font-mono break-all">{branch}</span>}
            {recent && <span>{recent.label} <TimeAgo ms={recent.ms} /></span>}
            {children}
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

