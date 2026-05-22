'use client';

import { useMemo, useRef, useState } from 'react';
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
import { api } from '@/lib/api';
import type { Card, Stage } from '@concerto/types';
import { useBoardState } from '@/hooks/use-board-state';
import { Column } from '@/components/column';
import { CardRow } from '@/components/card-row';

interface Props {
    projectId: string;
    stages: Stage[];
    initialCards: Card[];
}

export function Board({ projectId, stages, initialCards }: Props) {
    const { cards, setCards, worktreeMeta, streamingCardIds, error, setError } = useBoardState(projectId, initialCards);
    const [activeId, setActiveId] = useState<string | null>(null);
    // Snapshot before drag so we can roll back if the API rejects the move.
    const preDragRef = useRef<Card[] | null>(null);
    const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

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
        if (movedCard.stage_id === originalStage) return;

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
