'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
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
    arrayMove,
    horizontalListSortingStrategy,
} from '@dnd-kit/sortable';
import { api } from '@/lib/api';
import type { Card, Project, Stage, StageKind } from '@coro/types';
import { useBoardState } from '@/hooks/use-board-state';
import { Column, type StagePatch } from '@/components/column';
import { CardRow } from '@/components/card-row';
import { BoardHeader } from '@/components/board-header';
import { AddStageSlot } from '@/components/add-stage-slot';
import { CardActionsBar } from '@/components/card-actions-bar';
import { SelectionProvider, useSelection } from '@/components/card-selection-context';
import { isStageSortId, parseStageDropId, parseStageSortId, stageSortId } from '@/lib/dnd-ids';

type StageInput = { id?: string; name: string; kind: StageKind };

interface Props {
    project: Project;
    initialStages: Stage[];
    initialCards: Card[];
}

export function Board(props: Props) {
    return (
        <SelectionProvider>
            <BoardInner {...props} />
        </SelectionProvider>
    );
}

function BoardInner({ project, initialStages, initialCards }: Props) {
    const projectId = project.id;
    const selection = useSelection();
    const { cards, setCards, worktreeMeta, streamingCardIds, error, setError } = useBoardState(projectId, initialCards);
    const [stages, setStages] = useState<Stage[]>(initialStages);
    useEffect(() => { setStages(initialStages); }, [initialStages]);

    const [activeId, setActiveId] = useState<string | null>(null);
    const preDragCardsRef = useRef<Card[] | null>(null);
    const preDragStagesRef = useRef<Stage[] | null>(null);
    const groupDragIdsRef = useRef<string[] | null>(null);
    const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

    useEffect(() => {
        if (!selection || selection.count === 0) return;
        function onKey(e: KeyboardEvent) {
            if (e.key === 'Escape') selection!.clear();
        }
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, [selection, selection?.count]);

    const cardsByStage = useMemo(() => groupByStage(stages, cards), [stages, cards]);
    const activeCard = activeId && !isStageSortId(activeId)
        ? cards.find((c) => c.id === activeId) ?? null
        : null;

    function resolveCardStageId(overId: string): string | undefined {
        const dropStageId = parseStageDropId(overId);
        if (dropStageId) return dropStageId;
        return cards.find((c) => c.id === overId)?.stage_id;
    }

    function onDragStart(e: DragStartEvent) {
        const id = String(e.active.id);
        setActiveId(id);
        setError(null);
        if (isStageSortId(id)) {
            preDragStagesRef.current = stages;
            return;
        }
        preDragCardsRef.current = cards;
        // Group drag: if the active card is part of a multi-selection, move them all.
        if (selection && selection.has(id) && selection.count > 1) {
            groupDragIdsRef.current = [...selection.selectedIds];
        } else {
            groupDragIdsRef.current = [id];
        }
    }

    function onDragOver(e: DragOverEvent) {
        const { active, over } = e;
        if (!over) return;
        const activeIdStr = String(active.id);
        if (isStageSortId(activeIdStr)) {
            const overIdStr = String(over.id);
            if (!isStageSortId(overIdStr) || activeIdStr === overIdStr) return;
            const fromId = parseStageSortId(activeIdStr)!;
            const toId = parseStageSortId(overIdStr)!;
            setStages((prev) => {
                const from = prev.findIndex((s) => s.id === fromId);
                const to = prev.findIndex((s) => s.id === toId);
                if (from < 0 || to < 0) return prev;
                return arrayMove(prev, from, to);
            });
            return;
        }
        const overIdStr = String(over.id);
        const activeCard = cards.find((c) => c.id === activeIdStr);
        if (!activeCard) return;
        const toStage = resolveCardStageId(overIdStr);
        if (!toStage) return;

        // Cross-stage: move active (and any selected group) into the target stage.
        if (activeCard.stage_id !== toStage) {
            const groupIds = groupDragIdsRef.current ?? [activeIdStr];
            setCards((prev) => {
                let next = prev;
                for (const id of groupIds) {
                    next = moveCardToStage(next, id, toStage);
                }
                return next;
            });
            return;
        }

        // Same stage: reorder around the hovered card.
        if (overIdStr.startsWith('stage:')) return;
        const overCard = cards.find((c) => c.id === overIdStr);
        if (!overCard || overCard.id === activeCard.id) return;
        setCards((prev) => {
            const activeIdx = prev.findIndex((c) => c.id === activeIdStr);
            const overIdx = prev.findIndex((c) => c.id === overIdStr);
            if (activeIdx < 0 || overIdx < 0) return prev;
            const moved = arrayMove(prev, activeIdx, overIdx);
            let pos = 0;
            return moved.map((c) => (c.stage_id === toStage ? { ...c, position: pos++ } : c));
        });
    }

    async function onDragEnd(e: DragEndEvent) {
        const activeIdStr = String(e.active.id);
        setActiveId(null);

        if (isStageSortId(activeIdStr)) {
            const start = preDragStagesRef.current;
            preDragStagesRef.current = null;
            if (!start) return;
            const orderChanged = start.some((s, i) => s.id !== stages[i]?.id);
            if (!orderChanged) return;
            await mutateStages(stages.map((s) => ({ id: s.id, name: s.name, kind: s.kind })));
            return;
        }

        const startCards = preDragCardsRef.current;
        const groupIds = groupDragIdsRef.current ?? [activeIdStr];
        preDragCardsRef.current = null;
        groupDragIdsRef.current = null;
        if (!startCards) return;

        const moved = cards.find((c) => c.id === activeIdStr);
        if (!moved) return;
        const original = startCards.find((c) => c.id === activeIdStr);
        if (!original) return;

        // Same stage = pure reorder. PATCH new positions if anything shifted.
        if (moved.stage_id === original.stage_id) {
            const stageId = moved.stage_id;
            const before = startCards
                .filter((c) => c.stage_id === stageId)
                .sort((a, b) => a.position - b.position)
                .map((c) => c.id);
            const after = cards
                .filter((c) => c.stage_id === stageId)
                .sort((a, b) => a.position - b.position)
                .map((c) => c.id);
            const orderChanged = before.length !== after.length || before.some((id, i) => id !== after[i]);
            if (!orderChanged) return;
            const results = await Promise.allSettled(
                after.map((id, i) => api.patch(`/cards/${id}`, { position: i })),
            );
            const failed = results.filter((r) => r.status === 'rejected').length;
            if (failed > 0) {
                setError(`${failed} card${failed === 1 ? '' : 's'} failed to reorder`);
                setCards(startCards);
            }
            return;
        }

        const toStage = moved.stage_id;

        const results = await Promise.allSettled(
            groupIds.map((id) => commitTransition(id, toStage)),
        );
        const updatedCards: Card[] = [];
        const failedIds: string[] = [];
        results.forEach((r, i) => {
            if (r.status === 'fulfilled' && r.value.ok) updatedCards.push(r.value.card);
            else failedIds.push(groupIds[i]);
        });
        setCards((prev) => {
            const byId = new Map(updatedCards.map((c) => [c.id, c]));
            let next = prev.map((c) => byId.get(c.id) ?? c);
            // Roll back the failed ones to their pre-drag stage.
            if (failedIds.length > 0) {
                const fallback = new Map(startCards.map((c) => [c.id, c]));
                next = next.map((c) => (failedIds.includes(c.id) ? fallback.get(c.id) ?? c : c));
            }
            return next;
        });
        if (failedIds.length > 0) {
            setError(`${failedIds.length} of ${groupIds.length} card${groupIds.length === 1 ? '' : 's'} failed to move`);
        }
    }

    async function mutateStages(next: StageInput[]) {
        const rollback = stages;
        try {
            await api.put(`/projects/${projectId}/stages`, { stages: next });
            const fresh = await api.get<Stage[]>(`/projects/${projectId}/stages`);
            setStages(fresh);
        } catch (err: any) {
            setStages(rollback);
            setError(err.body?.error?.message || err.message);
        }
    }

    async function applyStagePatch(patch: StagePatch) {
        let next: Stage[];
        if (patch.type === 'rename') {
            next = stages.map((s) => (s.id === patch.id ? { ...s, name: patch.name } : s));
        } else if (patch.type === 'kind') {
            next = stages.map((s) => (s.id === patch.id ? { ...s, kind: patch.kind } : s));
        } else {
            next = stages.filter((s) => s.id !== patch.id);
        }
        setStages(next);
        await mutateStages(next.map((s) => ({ id: s.id, name: s.name, kind: s.kind })));
    }

    async function addStage(name: string, kind: StageKind) {
        await mutateStages([
            ...stages.map((s) => ({ id: s.id, name: s.name, kind: s.kind })),
            { name, kind },
        ]);
    }

    return (
        <>
            <BoardHeader project={project} />
            {error && (
                <div className="mx-8 mb-2 text-xs text-[var(--muted-foreground)]">
                    {error}
                </div>
            )}
            <div className="flex-1 min-h-0 overflow-x-auto px-8 pb-6" onClick={(e) => {
                // Click on empty board area clears selection.
                if (e.target === e.currentTarget && selection) selection.clear();
            }}>
                <DndContext
                    sensors={sensors}
                    collisionDetection={closestCorners}
                    onDragStart={onDragStart}
                    onDragOver={onDragOver}
                    onDragEnd={onDragEnd}
                    onDragCancel={() => {
                        if (preDragCardsRef.current) setCards(preDragCardsRef.current);
                        if (preDragStagesRef.current) setStages(preDragStagesRef.current);
                        preDragCardsRef.current = null;
                        preDragStagesRef.current = null;
                        groupDragIdsRef.current = null;
                        setActiveId(null);
                    }}
                >
                    <SortableContext
                        items={stages.map((s) => stageSortId(s.id))}
                        strategy={horizontalListSortingStrategy}
                    >
                        <div className="flex gap-6 min-w-max items-stretch h-full">
                            {stages.map((stage) => (
                                <Column
                                    key={stage.id}
                                    stage={stage}
                                    cards={cardsByStage.get(stage.id) || []}
                                    projectId={projectId}
                                    worktreeMeta={worktreeMeta}
                                    streamingCardIds={streamingCardIds}
                                    onStagePatch={applyStagePatch}
                                />
                            ))}
                            <AddStageSlot onAdd={addStage} />
                        </div>
                    </SortableContext>
                    <DragOverlay>
                        {activeCard ? (
                            <div className="relative">
                                <CardRow
                                    projectId={projectId}
                                    card={activeCard}
                                    stageKind={stages.find((s) => s.id === activeCard.stage_id)?.kind}
                                    worktreeMeta={worktreeMeta[activeCard.id]}
                                    streaming={streamingCardIds.has(activeCard.id)}
                                    dragging
                                />
                                {groupDragIdsRef.current && groupDragIdsRef.current.length > 1 && (
                                    <span className="absolute -bottom-2 -right-2 rounded-full bg-[var(--accent)] text-[var(--accent-foreground)] px-2 py-0.5 text-xs font-semibold shadow">
                                        +{groupDragIdsRef.current.length - 1}
                                    </span>
                                )}
                            </div>
                        ) : null}
                    </DragOverlay>
                </DndContext>
            </div>
            <CardActionsBar cards={cards} stages={stages} />
        </>
    );
}

function groupByStage(stages: Stage[], cards: Card[]): Map<string, Card[]> {
    const map = new Map<string, Card[]>();
    for (const s of stages) map.set(s.id, []);
    for (const c of cards) {
        if (!map.has(c.stage_id)) map.set(c.stage_id, []);
        map.get(c.stage_id)!.push(c);
    }
    for (const list of map.values()) list.sort((a, b) => a.position - b.position);
    return map;
}

function moveCardToStage(prev: Card[], cardId: string, toStage: string): Card[] {
    const moving = prev.find((c) => c.id === cardId);
    if (!moving) return prev;
    if (moving.stage_id === toStage) return prev;
    const without = prev.filter((c) => c.id !== cardId);
    const targetCount = without.filter((c) => c.stage_id === toStage).length;
    return [...without, { ...moving, stage_id: toStage, position: targetCount }];
}

type TransitionResult = { ok: true; card: Card } | { ok: false; message: string };

async function commitTransition(cardId: string, toStageId: string): Promise<TransitionResult> {
    try {
        const card = await api.post<Card>(`/cards/${cardId}/transitions`, { to_stage_id: toStageId, actor: 'user' });
        return { ok: true, card };
    } catch (err: any) {
        const allowed = err.body?.error?.allowed as string[] | undefined;
        if (allowed && allowed.length > 0) {
            try {
                const card = await api.post<Card>(`/cards/${cardId}/transitions`, { to_stage_id: allowed[0], actor: 'user' });
                return { ok: true, card };
            } catch (err2: any) {
                return { ok: false, message: err2.message };
            }
        }
        return { ok: false, message: err.message };
    }
}
