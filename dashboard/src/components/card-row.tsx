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
    awaitingAnswer?: boolean;
    dragging?: boolean;
}

export function CardRow({ projectId, card, stageKind, worktreeMeta, streaming, awaitingAnswer, dragging }: Props) {
    const router = useRouter();
    const selection = useSelection();
    const selected = selection?.has(card.id) ?? false;
    const [editing, setEditing] = useState(false);
    const [optimisticTitle, setOptimisticTitle] = useState<string | null>(null);

    const dirty = (worktreeMeta?.dirty_files ?? 0) > 0;
    const conflict = worktreeMeta?.merge_conflict_at != null;
    const additions = worktreeMeta?.additions ?? 0;
    const deletions = worktreeMeta?.deletions ?? 0;
    const changedFiles = worktreeMeta?.changed_files ?? 0;
    const dot = streaming
        ? { color: 'bg-green-500', pulse: true, label: 'running' }
        : awaitingAnswer
            ? { color: 'bg-yellow-500', pulse: false, label: 'waiting on you' }
            : conflict
                ? { color: 'bg-red-500', pulse: false, label: 'merge conflict' }
                : dirty
                    ? { color: 'bg-orange-500', pulse: false, label: `${worktreeMeta?.dirty_files} uncommitted` }
                    : null;
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
    const titleClass = cn(
        'flex items-center gap-2 leading-snug',
        wantsAttention ? 'text-base font-bold' : 'text-sm font-semibold',
    );

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
                    {dot && <StatusDot color={dot.color} pulse={dot.pulse} label={dot.label} />}
                    <InlineText
                        value={title}
                        autoEdit
                        placeholder="Card title"
                        onSubmit={rename}
                        onCancel={() => setEditing(false)}
                    />
                </div>
                <CardMeta card={card} additions={additions} deletions={deletions} changedFiles={changedFiles} />
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
                {dot && <StatusDot color={dot.color} pulse={dot.pulse} label={dot.label} />}
                {title}
            </div>
            <CardMeta card={card} additions={additions} deletions={deletions} changedFiles={changedFiles} />
        </Link>
    );
}

function StatusDot({ color, pulse, label }: { color: string; pulse: boolean; label: string }) {
    return (
        <span
            aria-label={label}
            title={label}
            className={cn('inline-block h-2 w-2 shrink-0 rounded-full', color, pulse && 'animate-pulse')}
        />
    );
}

function CardMeta({
    card, additions, deletions, changedFiles, children,
}: {
    card: Card;
    additions: number;
    deletions: number;
    changedFiles: number;
    children?: React.ReactNode;
}) {
    const recent = pickRecentTimestamp(card);
    const branch = card.branch_name?.replace(/^coro\//, '');
    const hasDiff = changedFiles > 0;
    if (!recent && !branch && !hasDiff && !children) return null;
    return (
        <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1 text-xs opacity-60">
            {branch && <span className="font-mono break-all">{branch}</span>}
            {hasDiff && (
                <span className="tabular-nums">
                    <span className="text-green-700">+{additions}</span>{' '}
                    <span className="text-red-700">-{deletions}</span>
                    <span className="text-[#3a2d0a]/70"> · {changedFiles} file{changedFiles === 1 ? '' : 's'}</span>
                </span>
            )}
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

