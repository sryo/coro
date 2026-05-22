'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
    DndContext,
    DragOverlay,
    PointerSensor,
    useSensor,
    useSensors,
    closestCorners,
    type DragEndEvent,
    type DragOverEvent,
    type DragStartEvent,
} from '@dnd-kit/core';
import {
    SortableContext,
    useSortable,
    verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { useDroppable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { api, openProjectStream } from '@/lib/api';
import type { Card, Stage } from '@concerto/types';
import { TimeAgo } from '@/components/time-ago';

interface WorktreeMeta {
    state: string;
    dirty_files: number;
    behind: number;
    merge_conflict_at: number | null;
}

interface BoardResponse {
    cards: Card[];
    worktree_meta?: Record<string, WorktreeMeta>;
}

// Show "rebase" badge when a worktree is this many commits behind base.
const STALE_BEHIND_THRESHOLD = 10;

interface Props {
    projectId: string;
    stages: Stage[];
    initialCards: Card[];
}

export function Board({ projectId, stages, initialCards }: Props) {
    const [cards, setCards] = useState<Card[]>(initialCards);
    const [worktreeMeta, setWorktreeMeta] = useState<Record<string, WorktreeMeta>>({});
    const [streamingCardIds, setStreamingCardIds] = useState<Set<string>>(new Set());
    const [activeId, setActiveId] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    // Snapshot before drag so we can roll back if the API rejects the move.
    const preDragRef = useRef<Card[] | null>(null);
    const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

    // Poll the board endpoint to refresh cards + worktree state.
    useEffect(() => {
        let cancelled = false;
        const tick = async () => {
            if (cancelled || activeId) return;
            try {
                const next = await api.get<BoardResponse>(`/projects/${projectId}/board`);
                if (!cancelled && !activeId) {
                    setCards(next.cards);
                    setWorktreeMeta(next.worktree_meta || {});
                }
            } catch {}
        };
        tick();
        const id = setInterval(tick, 4000);
        return () => { cancelled = true; clearInterval(id); };
    }, [projectId, activeId]);

    // Live event stream — flip cards in/out of streaming as turns start and end.
    useEffect(() => {
        const es = openProjectStream(projectId, (type, data) => {
            const cardId = data?.card_id;
            if (!cardId) return;
            if (type === 'card:turn_started') {
                setStreamingCardIds((prev) => {
                    if (prev.has(cardId)) return prev;
                    const next = new Set(prev);
                    next.add(cardId);
                    return next;
                });
            } else if (type === 'card:turn_complete' || type === 'card:turn_failed' || type === 'card:error') {
                setStreamingCardIds((prev) => {
                    if (!prev.has(cardId)) return prev;
                    const next = new Set(prev);
                    next.delete(cardId);
                    return next;
                });
            }
        });
        return () => es.close();
    }, [projectId]);

    const cardsByStage = useMemo(() => {
        const map = new Map<string, Card[]>();
        for (const s of stages) map.set(s.id, []);
        for (const c of cards) {
            if (!map.has(c.stage_id)) map.set(c.stage_id, []);
            map.get(c.stage_id)!.push(c);
        }
        for (const list of map.values()) list.sort((a, b) => a.position - b.position);
        return map;
    }, [stages, cards]);

    const activeCard = activeId ? cards.find((c) => c.id === activeId) ?? null : null;

    function findStageOf(cardId: string): string | undefined {
        return cards.find((c) => c.id === cardId)?.stage_id;
    }

    function resolveStageId(overId: string): string | undefined {
        if (overId.startsWith('stage:')) return overId.slice('stage:'.length);
        return findStageOf(overId);
    }

    function onDragStart(e: DragStartEvent) {
        setActiveId(String(e.active.id));
        setError(null);
        preDragRef.current = cards;
    }

    function onDragOver(e: DragOverEvent) {
        const { active, over } = e;
        if (!over) return;
        const activeIdStr = String(active.id);
        const overIdStr = String(over.id);
        const fromStage = findStageOf(activeIdStr);
        const toStage = resolveStageId(overIdStr);
        if (!fromStage || !toStage || fromStage === toStage) return;
        // Optimistically move into the new column at the end.
        setCards((prev) => {
            const moving = prev.find((c) => c.id === activeIdStr);
            if (!moving) return prev;
            const withoutMoving = prev.filter((c) => c.id !== activeIdStr);
            const targetCount = withoutMoving.filter((c) => c.stage_id === toStage).length;
            return [...withoutMoving, { ...moving, stage_id: toStage, position: targetCount }];
        });
    }

    async function onDragEnd(e: DragEndEvent) {
        const activeIdStr = String(e.active.id);
        const startCards = preDragRef.current;
        setActiveId(null);
        preDragRef.current = null;
        if (!startCards) return;
        const originalStage = startCards.find((c) => c.id === activeIdStr)?.stage_id;
        const movedCard = cards.find((c) => c.id === activeIdStr);
        if (!originalStage || !movedCard) return;
        if (movedCard.stage_id === originalStage) return; // no-op

        try {
            const updated = await api.post<Card>(`/cards/${activeIdStr}/transitions`, {
                to_stage_id: movedCard.stage_id,
                actor: 'user',
            });
            setCards((prev) => prev.map((c) => (c.id === activeIdStr ? updated : c)));
        } catch (err: any) {
            const allowed = err.body?.error?.allowed as string[] | undefined;
            if (allowed && allowed.length > 0) {
                try {
                    const updated = await api.post<Card>(`/cards/${activeIdStr}/transitions`, {
                        to_stage_id: allowed[0],
                        actor: 'user',
                    });
                    setCards((prev) => prev.map((c) => (c.id === activeIdStr ? updated : c)));
                    return;
                } catch (err2: any) {
                    setError(err2.message);
                }
            } else {
                setError(err.message);
            }
            // rollback
            setCards(startCards);
        }
    }

    return (
        <div className="overflow-x-auto px-8 py-6">
            {error && (
                <div className="mb-4 rounded-md border border-[var(--border)] px-3 py-2 text-xs text-[var(--muted-foreground)]">
                    {error}
                </div>
            )}
            <DndContext
                sensors={sensors}
                collisionDetection={closestCorners}
                onDragStart={onDragStart}
                onDragOver={onDragOver}
                onDragEnd={onDragEnd}
                onDragCancel={() => {
                    if (preDragRef.current) setCards(preDragRef.current);
                    preDragRef.current = null;
                    setActiveId(null);
                }}
            >
                <div className="flex gap-6 min-w-max">
                    {stages.map((stage) => (
                        <Column
                            key={stage.id}
                            stage={stage}
                            cards={cardsByStage.get(stage.id) || []}
                            projectId={projectId}
                            worktreeMeta={worktreeMeta}
                            streamingCardIds={streamingCardIds}
                        />
                    ))}
                </div>
                <DragOverlay>
                    {activeCard ? (
                        <CardRow
                            projectId={projectId}
                            card={activeCard}
                            worktreeMeta={worktreeMeta[activeCard.id]}
                            streaming={streamingCardIds.has(activeCard.id)}
                            dragging
                        />
                    ) : null}
                </DragOverlay>
            </DndContext>
        </div>
    );
}

function Column({
    stage, cards, projectId, worktreeMeta, streamingCardIds,
}: {
    stage: Stage;
    cards: Card[];
    projectId: string;
    worktreeMeta: Record<string, WorktreeMeta>;
    streamingCardIds: Set<string>;
}) {
    const { setNodeRef, isOver } = useDroppable({ id: `stage:${stage.id}` });
    return (
        <section className="w-72 shrink-0">
            <header className="mb-4 flex items-baseline justify-between">
                <h2 className="text-sm font-semibold uppercase tracking-wide">{stage.name}</h2>
                <span className="text-xs text-[var(--muted-foreground)]">{cards.length}</span>
            </header>
            <SortableContext items={cards.map((c) => c.id)} strategy={verticalListSortingStrategy}>
                <ul
                    ref={setNodeRef}
                    className={`min-h-[80px] space-y-2 rounded-md p-1 -m-1 ${isOver ? 'bg-[var(--muted)]' : ''}`}
                >
                    {cards.map((card) => (
                        <SortableCard
                            key={card.id}
                            projectId={projectId}
                            card={card}
                            worktreeMeta={worktreeMeta[card.id]}
                            streaming={streamingCardIds.has(card.id)}
                        />
                    ))}
                    {cards.length === 0 && (
                        <li className="px-3 py-2 text-xs text-[var(--muted-foreground)]">—</li>
                    )}
                </ul>
            </SortableContext>
        </section>
    );
}

function SortableCard({
    projectId, card, worktreeMeta, streaming,
}: {
    projectId: string;
    card: Card;
    worktreeMeta?: WorktreeMeta;
    streaming: boolean;
}) {
    const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: card.id });
    const style = {
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0 : 1,
    };
    return (
        <li ref={setNodeRef} style={style} {...attributes} {...listeners}>
            <CardRow
                projectId={projectId}
                card={card}
                worktreeMeta={worktreeMeta}
                streaming={streaming}
            />
        </li>
    );
}

function CardRow({
    projectId, card, worktreeMeta, streaming, dragging,
}: {
    projectId: string;
    card: Card;
    worktreeMeta?: WorktreeMeta;
    streaming?: boolean;
    dragging?: boolean;
}) {
    const wtMissing = worktreeMeta?.state === 'missing';
    const dirty = (worktreeMeta?.dirty_files ?? 0) > 0;
    const stale = (worktreeMeta?.behind ?? 0) > STALE_BEHIND_THRESHOLD;
    const conflict = worktreeMeta?.merge_conflict_at != null;
    return (
        <Link
            href={`/p/${projectId}/c/${card.id}`}
            onClick={(e) => { if (dragging) e.preventDefault(); }}
            className={`block rounded-md border border-[var(--border)] bg-[var(--background)] p-4 hover:border-[var(--foreground)] ${dragging ? 'shadow-lg cursor-grabbing' : 'cursor-grab'}`}
        >
            <div className="flex items-start gap-2">
                {streaming && (
                    <span
                        className="mt-1.5 inline-block h-2 w-2 shrink-0 animate-pulse rounded-full bg-[var(--foreground)]"
                        title="agent is mid-turn"
                        aria-label="streaming"
                    />
                )}
                {!streaming && conflict && (
                    <span
                        className="mt-1.5 inline-block h-2 w-2 shrink-0 rounded-full bg-red-500"
                        title="last merge attempt had conflicts"
                        aria-label="merge conflict"
                    />
                )}
                {!streaming && !conflict && dirty && (
                    <span
                        className="mt-1.5 inline-block h-2 w-2 shrink-0 rounded-full bg-orange-500"
                        title={`worktree has ${worktreeMeta!.dirty_files} uncommitted file(s)`}
                        aria-label="dirty worktree"
                    />
                )}
                <div className="text-sm font-semibold leading-snug">{card.title}</div>
            </div>
            <div className="mt-2 flex items-baseline gap-3 text-xs text-[var(--muted-foreground)]">
                <span className="font-mono">{card.id.slice(0, 6)}</span>
                {card.branch_name && (
                    <span className="font-mono truncate">{card.branch_name.replace(/^concerto\//, '')}</span>
                )}
                {wtMissing && (
                    <span className="rounded border border-[var(--border)] px-1.5 py-0.5 text-[10px] uppercase tracking-wide">
                        worktree missing
                    </span>
                )}
                {!wtMissing && stale && (
                    <span
                        className="rounded border border-[var(--border)] px-1.5 py-0.5 text-[10px] uppercase tracking-wide"
                        title={`${worktreeMeta!.behind} commits behind base`}
                    >
                        rebase
                    </span>
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
        <div className="mt-1 text-xs text-[var(--muted-foreground)]">
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
