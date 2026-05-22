'use client';

import { useEffect, useRef, useState } from 'react';
import { useDroppable } from '@dnd-kit/core';
import {
    SortableContext,
    useSortable,
    verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { Card, Stage, StageKind, WorktreeBoardMeta } from '@coro/types';
import { CardRow } from '@/components/card-row';
import { InlineNewCardForm } from '@/components/new-card-button';
import { InlineText } from '@/components/inline-edit';
import { stageDropId, stageSortId } from '@/lib/dnd-ids';

const ALL_KINDS: StageKind[] = ['backlog', 'ready', 'active', 'review', 'done', 'archive'];

export type StagePatch =
    | { type: 'rename'; id: string; name: string }
    | { type: 'kind'; id: string; kind: StageKind }
    | { type: 'remove'; id: string };

interface Props {
    stage: Stage;
    cards: Card[];
    projectId: string;
    worktreeMeta: Record<string, WorktreeBoardMeta>;
    streamingCardIds: Set<string>;
    onStagePatch: (patch: StagePatch) => Promise<void>;
}

export function Column({ stage, cards, projectId, worktreeMeta, streamingCardIds, onStagePatch }: Props) {
    const sortable = useSortable({ id: stageSortId(stage.id) });
    const droppable = useDroppable({ id: stageDropId(stage.id) });
    const isBacklog = stage.kind === 'backlog';

    const style: React.CSSProperties = {
        transform: CSS.Transform.toString(sortable.transform),
        transition: sortable.transition,
        opacity: sortable.isDragging ? 0.5 : 1,
    };

    const setSectionRef = (node: HTMLElement | null) => {
        sortable.setNodeRef(node);
        droppable.setNodeRef(node);
    };

    return (
        <section
            ref={setSectionRef}
            style={style}
            className={`group/column flex flex-col w-72 shrink-0 h-full rounded-lg p-4 transition-colors hover:bg-[color-mix(in_srgb,var(--foreground)_3%,transparent)] ${droppable.isOver ? 'bg-[color-mix(in_srgb,var(--foreground)_3%,transparent)]' : ''}`}
        >
            <header className="mb-4 flex items-baseline gap-2">
                <button
                    {...sortable.attributes}
                    {...sortable.listeners}
                    type="button"
                    aria-label="Drag to reorder column"
                    className="cursor-grab active:cursor-grabbing px-1 text-[var(--muted-foreground)] opacity-0 group-hover/column:opacity-100 transition-opacity"
                >
                    ⋮⋮
                </button>
                <h2 className="flex-1 text-sm font-semibold tracking-tight">
                    <InlineText
                        value={stage.name}
                        placeholder="Stage name"
                        onSubmit={(name) => onStagePatch({ type: 'rename', id: stage.id, name })}
                    />
                </h2>
                <StageMenu
                    stage={stage}
                    cardCount={cards.length}
                    onKindChange={(kind) => onStagePatch({ type: 'kind', id: stage.id, kind })}
                    onRemove={() => onStagePatch({ type: 'remove', id: stage.id })}
                />
                <span className="text-xs tabular-nums text-[var(--muted-foreground)]">{cards.length}</span>
            </header>
            <SortableContext items={cards.map((c) => c.id)} strategy={verticalListSortingStrategy}>
                <ul className="flex-1 min-h-[80px] space-y-2 overflow-y-auto">
                    {cards.map((card) => (
                        <SortableCard
                            key={card.id}
                            projectId={projectId}
                            card={card}
                            stageKind={stage.kind}
                            worktreeMeta={worktreeMeta[card.id]}
                            streaming={streamingCardIds.has(card.id)}
                        />
                    ))}
                    {isBacklog && (
                        <li>
                            <InlineNewCardForm projectId={projectId} />
                        </li>
                    )}
                </ul>
            </SortableContext>
        </section>
    );
}

function StageMenu({
    stage,
    cardCount,
    onKindChange,
    onRemove,
}: {
    stage: Stage;
    cardCount: number;
    onKindChange: (k: StageKind) => void;
    onRemove: () => Promise<void> | void;
}) {
    const [open, setOpen] = useState(false);
    const [confirming, setConfirming] = useState(false);
    const ref = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!open) return;
        function onDown(e: MouseEvent) {
            if (ref.current && !ref.current.contains(e.target as Node)) close();
        }
        function onKey(e: KeyboardEvent) {
            if (e.key === 'Escape') close();
        }
        document.addEventListener('mousedown', onDown);
        document.addEventListener('keydown', onKey);
        return () => {
            document.removeEventListener('mousedown', onDown);
            document.removeEventListener('keydown', onKey);
        };
    }, [open]);

    function close() {
        setOpen(false);
        setConfirming(false);
    }

    return (
        <div ref={ref} className="relative opacity-0 group-hover/column:opacity-100 focus-within:opacity-100 transition-opacity">
            <button
                type="button"
                onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
                onPointerDown={(e) => e.stopPropagation()}
                className="px-1 text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
                aria-label="Stage options"
            >
                more
            </button>
            {open && (
                <div
                    className="absolute right-0 top-full z-10 mt-1 min-w-[180px] rounded-md border border-[var(--border)] bg-[var(--background)] py-1 text-xs shadow-md"
                    onPointerDown={(e) => e.stopPropagation()}
                >
                    {confirming ? (
                        <div className="px-3 py-2 space-y-2">
                            <p className="text-[var(--muted-foreground)]">
                                {cardCount > 0 ? `Remove ${stage.name} and its ${cardCount} card${cardCount === 1 ? '' : 's'}?` : `Remove ${stage.name}?`}
                            </p>
                            <div className="flex gap-3">
                                <button
                                    type="button"
                                    onClick={async () => { await onRemove(); close(); }}
                                    className="font-semibold hover:underline"
                                >
                                    remove
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setConfirming(false)}
                                    className="text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
                                >
                                    cancel
                                </button>
                            </div>
                        </div>
                    ) : (
                        <>
                            <p className="px-3 pt-1 pb-1 text-[var(--muted-foreground)]">kind</p>
                            <ul>
                                {ALL_KINDS.map((k) => (
                                    <li key={k}>
                                        <button
                                            type="button"
                                            onClick={() => { onKindChange(k); close(); }}
                                            className={`block w-full px-3 py-1 text-left font-mono lowercase hover:bg-[var(--muted)] ${k === stage.kind ? 'text-[var(--foreground)]' : 'text-[var(--muted-foreground)]'}`}
                                        >
                                            {k}
                                        </button>
                                    </li>
                                ))}
                            </ul>
                            <div className="my-1 border-t border-[var(--border)]" />
                            <button
                                type="button"
                                onClick={() => setConfirming(true)}
                                className="block w-full px-3 py-1 text-left hover:bg-[var(--muted)]"
                            >
                                remove stage
                            </button>
                        </>
                    )}
                </div>
            )}
        </div>
    );
}

function SortableCard({
    projectId, card, stageKind, worktreeMeta, streaming,
}: {
    projectId: string;
    card: Card;
    stageKind: StageKind;
    worktreeMeta?: WorktreeBoardMeta;
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
                stageKind={stageKind}
                worktreeMeta={worktreeMeta}
                streaming={streaming}
            />
        </li>
    );
}
