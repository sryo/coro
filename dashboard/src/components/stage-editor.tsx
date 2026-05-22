'use client';

import { useState } from 'react';
import {
    DndContext,
    PointerSensor,
    useSensor,
    useSensors,
    closestCenter,
    type DragEndEvent,
} from '@dnd-kit/core';
import {
    arrayMove,
    SortableContext,
    useSortable,
    verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { api } from '@/lib/api';
import type { Stage, StageKind } from '@concerto/types';
import { Button } from '@/components/ui/button';

const KINDS: StageKind[] = ['backlog', 'ready', 'active', 'review', 'done', 'archive'];
const DEFAULT_STAGES: { name: string; kind: StageKind }[] = [
    { name: 'Backlog', kind: 'backlog' },
    { name: 'Ready', kind: 'ready' },
    { name: 'In Progress', kind: 'active' },
    { name: 'Testing', kind: 'active' },
    { name: 'Review', kind: 'review' },
    { name: 'Done', kind: 'done' },
    { name: 'Merged', kind: 'archive' },
];

interface DraftStage {
    key: string;
    id?: string;
    name: string;
    kind: StageKind;
}

let keyCounter = 0;
const nextKey = () => `k${++keyCounter}`;

function toDraft(stages: Stage[]): DraftStage[] {
    return stages.map((s) => ({ key: nextKey(), id: s.id, name: s.name, kind: s.kind }));
}

interface Props {
    projectId: string;
    initialStages: Stage[];
}

export function StageEditor({ projectId, initialStages }: Props) {
    const [draft, setDraft] = useState<DraftStage[]>(() => toDraft(initialStages));
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [saved, setSaved] = useState(false);
    const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

    function onDragEnd(e: DragEndEvent) {
        const { active, over } = e;
        if (!over || active.id === over.id) return;
        const oldIndex = draft.findIndex((s) => s.key === active.id);
        const newIndex = draft.findIndex((s) => s.key === over.id);
        if (oldIndex < 0 || newIndex < 0) return;
        setDraft((prev) => arrayMove(prev, oldIndex, newIndex));
    }

    function updateRow(key: string, patch: Partial<DraftStage>) {
        setDraft((prev) => prev.map((s) => (s.key === key ? { ...s, ...patch } : s)));
        setSaved(false);
    }

    function removeRow(key: string) {
        setDraft((prev) => prev.filter((s) => s.key !== key));
        setSaved(false);
    }

    function addRow() {
        setDraft((prev) => [...prev, { key: nextKey(), name: 'New Stage', kind: 'active' }]);
        setSaved(false);
    }

    function resetToDefaults() {
        setDraft(DEFAULT_STAGES.map((s) => ({ key: nextKey(), name: s.name, kind: s.kind })));
        setSaved(false);
    }

    async function save() {
        setBusy(true);
        setError(null);
        setSaved(false);
        try {
            await api.put(`/projects/${projectId}/stages`, {
                stages: draft.map((d) => ({ id: d.id, name: d.name, kind: d.kind })),
            });
            setSaved(true);
        } catch (err: any) {
            setError(err.body?.error?.message || err.message);
        } finally {
            setBusy(false);
        }
    }

    const missingKinds = ['backlog', 'active', 'review', 'archive'].filter(
        (k) => !draft.find((s) => s.kind === k),
    );

    return (
        <div className="space-y-6">
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
                <SortableContext items={draft.map((s) => s.key)} strategy={verticalListSortingStrategy}>
                    <ul className="space-y-2">
                        {draft.map((row) => (
                            <SortableRow
                                key={row.key}
                                row={row}
                                onChange={(patch) => updateRow(row.key, patch)}
                                onRemove={() => removeRow(row.key)}
                            />
                        ))}
                    </ul>
                </SortableContext>
            </DndContext>

            <div className="flex flex-wrap gap-3">
                <Button variant="subtle" size="sm" onClick={addRow}>+ Add stage</Button>
                <Button variant="ghost" size="sm" onClick={resetToDefaults}>Reset to defaults</Button>
                <div className="flex-1" />
                <Button size="sm" onClick={save} disabled={busy || missingKinds.length > 0}>
                    {busy ? 'Saving…' : 'Save changes'}
                </Button>
            </div>

            {missingKinds.length > 0 && (
                <p className="text-xs text-[var(--muted-foreground)]">
                    Missing required kinds: {missingKinds.join(', ')}
                </p>
            )}
            {error && (
                <p className="text-xs text-[var(--muted-foreground)]">{error}</p>
            )}
            {saved && !error && (
                <p className="text-xs text-[var(--muted-foreground)]">Saved.</p>
            )}
        </div>
    );
}

function SortableRow({
    row,
    onChange,
    onRemove,
}: {
    row: DraftStage;
    onChange: (patch: Partial<DraftStage>) => void;
    onRemove: () => void;
}) {
    const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: row.key });
    const style = {
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.5 : 1,
    };
    return (
        <li
            ref={setNodeRef}
            style={style}
            className="flex items-center gap-3 rounded-md border border-[var(--border)] bg-[var(--background)] p-3"
        >
            <button
                {...attributes}
                {...listeners}
                className="cursor-grab px-1 text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
                aria-label="Drag to reorder"
                type="button"
            >
                ⋮⋮
            </button>
            <input
                value={row.name}
                onChange={(e) => onChange({ name: e.target.value })}
                className="flex-1 rounded-md border border-[var(--border)] bg-transparent px-3 py-1.5 text-sm focus:outline-none focus:border-[var(--foreground)]"
                placeholder="Stage name"
            />
            <select
                value={row.kind}
                onChange={(e) => onChange({ kind: e.target.value as StageKind })}
                className="rounded-md border border-[var(--border)] bg-transparent px-3 py-1.5 text-sm focus:outline-none focus:border-[var(--foreground)]"
            >
                {KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
            </select>
            <button
                onClick={onRemove}
                type="button"
                className="text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)] px-2"
            >
                remove
            </button>
        </li>
    );
}
