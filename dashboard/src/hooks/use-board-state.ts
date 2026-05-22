'use client';

import { useEffect, useState } from 'react';
import { api, openProjectStream } from '@/lib/api';
import type { Card, WorktreeBoardMeta } from '@coro/types';

interface BoardResponse {
    cards: Card[];
    worktree_meta?: Record<string, WorktreeBoardMeta>;
}

export interface BoardState {
    cards: Card[];
    setCards: React.Dispatch<React.SetStateAction<Card[]>>;
    worktreeMeta: Record<string, WorktreeBoardMeta>;
    streamingCardIds: Set<string>;
    cardsAwaitingAnswer: Set<string>;
    error: string | null;
    setError: (e: string | null) => void;
}

function addToSet<T>(set: Set<T>, item: T): Set<T> {
    if (set.has(item)) return set;
    const next = new Set(set);
    next.add(item);
    return next;
}

function removeFromSet<T>(set: Set<T>, item: T): Set<T> {
    if (!set.has(item)) return set;
    const next = new Set(set);
    next.delete(item);
    return next;
}

function numOr(value: unknown, fallback: number): number {
    return typeof value === 'number' ? value : fallback;
}

// Owns the live board state for a project: cards, worktree metadata, and which
// cards are mid-turn. Initial cards come from SSR; worktree_meta is fetched
// once on mount (no polling). All subsequent updates flow through SSE.
export function useBoardState(projectId: string, initialCards: Card[]): BoardState {
    const [cards, setCards] = useState<Card[]>(initialCards);
    const [worktreeMeta, setWorktreeMeta] = useState<Record<string, WorktreeBoardMeta>>({});
    const [streamingCardIds, setStreamingCardIds] = useState<Set<string>>(new Set());
    const [cardsAwaitingAnswer, setCardsAwaitingAnswer] = useState<Set<string>>(new Set());
    const [error, setError] = useState<string | null>(null);

    // One-shot fetch for worktree_meta. The SSR payload only carries cards.
    // Future: a card:worktree_changed event would let us drop even this fetch.
    useEffect(() => {
        let cancelled = false;
        api.get<BoardResponse>(`/projects/${projectId}/board`)
            .then((res) => {
                if (cancelled) return;
                setWorktreeMeta(res.worktree_meta || {});
            })
            .catch(() => {});
        return () => { cancelled = true; };
    }, [projectId]);

    useEffect(() => {
        const es = openProjectStream(projectId, (type, data) => {
            const cardId = data?.card_id;
            if (type === 'connected') {
                // Reconcile streaming set against actual daemon state. Survives
                // daemon restarts: the daemon's live in-memory set is the truth.
                const live = Array.isArray(data?.streaming_card_ids) ? data.streaming_card_ids : [];
                setStreamingCardIds(new Set(live));
                return;
            }
            if (type === 'card:created' && cardId) {
                api.get<Card>(`/cards/${cardId}`)
                    .then((card) => {
                        setCards((prev) => (prev.find((c) => c.id === card.id) ? prev : [...prev, card]));
                    })
                    .catch(() => {});
                return;
            }
            if (type === 'card:deleted' && cardId) {
                setCards((prev) => prev.filter((c) => c.id !== cardId));
                setCardsAwaitingAnswer((prev) => removeFromSet(prev, cardId));
                return;
            }
            if (type === 'card:turn_started' && cardId) {
                setStreamingCardIds((prev) => addToSet(prev, cardId));
                return;
            }
            if ((type === 'card:turn_complete' || type === 'card:turn_failed' || type === 'card:error') && cardId) {
                setStreamingCardIds((prev) => removeFromSet(prev, cardId));
                return;
            }
            if (type === 'card:stage_changed' && cardId) {
                const toStageId = data?.to_stage_id;
                const position = typeof data?.position === 'number' ? data.position : undefined;
                if (!toStageId) return;
                setCards((prev) => {
                    let changed = false;
                    const next = prev.map((c) => {
                        if (c.id !== cardId) return c;
                        const nextPos = position ?? c.position;
                        if (c.stage_id === toStageId && c.position === nextPos) return c;
                        changed = true;
                        return { ...c, stage_id: toStageId, position: nextPos };
                    });
                    return changed ? next : prev;
                });
                setCardsAwaitingAnswer((prev) => removeFromSet(prev, cardId));
                return;
            }
            if (type === 'card:note' && cardId) {
                const kind = typeof data?.kind === 'string' ? data.kind : 'info';
                if (kind === 'question') {
                    setCardsAwaitingAnswer((prev) => addToSet(prev, cardId));
                }
                return;
            }
            if (type === 'card:message' && cardId) {
                const role = (data?.message as { role?: unknown } | undefined)?.role;
                if (role === 'user') {
                    setCardsAwaitingAnswer((prev) => removeFromSet(prev, cardId));
                }
                return;
            }
            if (type === 'card:worktree_changed' && cardId) {
                setWorktreeMeta((prev) => {
                    const current = prev[cardId];
                    if (!current) return prev;
                    const dirty_files = numOr(data?.dirty_files, current.dirty_files);
                    const behind = numOr(data?.behind, current.behind);
                    const additions = numOr(data?.additions, current.additions);
                    const deletions = numOr(data?.deletions, current.deletions);
                    const changed_files = numOr(data?.changed_files, current.changed_files);
                    if (
                        dirty_files === current.dirty_files
                        && behind === current.behind
                        && additions === current.additions
                        && deletions === current.deletions
                        && changed_files === current.changed_files
                    ) return prev;
                    return { ...prev, [cardId]: { ...current, dirty_files, behind, additions, deletions, changed_files } };
                });
                return;
            }
            if (type === 'card:merged' && cardId) {
                const toStageId = data?.to_stage_id;
                if (toStageId) {
                    setCards((prev) => prev.map((c) => (
                        c.id === cardId ? { ...c, stage_id: toStageId, merged_at: data?.merged_at ?? c.merged_at } : c
                    )));
                } else {
                    setCards((prev) => prev.filter((c) => c.id !== cardId));
                }
                setCardsAwaitingAnswer((prev) => removeFromSet(prev, cardId));
                return;
            }
            if (type === 'card:abandoned' && cardId) {
                setCards((prev) => prev.filter((c) => c.id !== cardId));
                setCardsAwaitingAnswer((prev) => removeFromSet(prev, cardId));
                return;
            }
            if (type === 'worktree:removed' && cardId) {
                setWorktreeMeta((prev) => {
                    if (!(cardId in prev)) return prev;
                    const next = { ...prev };
                    delete next[cardId];
                    return next;
                });
                return;
            }
        });
        return () => es.close();
    }, [projectId]);

    return { cards, setCards, worktreeMeta, streamingCardIds, cardsAwaitingAnswer, error, setError };
}
