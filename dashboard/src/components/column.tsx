'use client';

import { useDroppable } from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { Card, Stage, WorktreeBoardMeta } from '@concerto/types';
import { CardRow } from '@/components/card-row';
import { InlineNewCardForm } from '@/components/new-card-button';

interface Props {
    stage: Stage;
    cards: Card[];
    projectId: string;
    worktreeMeta: Record<string, WorktreeBoardMeta>;
    streamingCardIds: Set<string>;
}

export function Column({ stage, cards, projectId, worktreeMeta, streamingCardIds }: Props) {
    const { setNodeRef, isOver } = useDroppable({ id: `stage:${stage.id}` });
    const isBacklog = stage.kind === 'backlog';
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

function SortableCard({
    projectId, card, worktreeMeta, streaming,
}: {
    projectId: string;
    card: Card;
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
                worktreeMeta={worktreeMeta}
                streaming={streaming}
            />
        </li>
    );
}
