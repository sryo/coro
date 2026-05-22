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
    error: string | null;
    setError: (e: string | null) => void;
}

// Owns the live board state for a project: cards, worktree metadata, and which
// cards are mid-turn. Initial cards come from SSR; worktree_meta is fetched
// once on mount (no polling). All subsequent updates flow through SSE.
export function useBoardState(projectId: string, initialCards: Card[]): BoardState {
    const [cards, setCards] = useState<Card[]>(initialCards);
    const [worktreeMeta, setWorktreeMeta] = useState<Record<string, WorktreeBoardMeta>>({});
    const [streamingCardIds, setStreamingCardIds] = useState<Set<string>>(new Set());
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
            if (type === 'card:turn_started' && cardId) {
                setStreamingCardIds((prev) => {
                    if (prev.has(cardId)) return prev;
                    const next = new Set(prev);
                    next.add(cardId);
                    return next;
                });
                return;
            }
            if ((type === 'card:turn_complete' || type === 'card:turn_failed' || type === 'card:error') && cardId) {
                setStreamingCardIds((prev) => {
                    if (!prev.has(cardId)) return prev;
                    const next = new Set(prev);
                    next.delete(cardId);
                    return next;
                });
                return;
            }
            if (type === 'card:stage_changed' && cardId) {
                const toStageId = data?.to_stage_id;
                const position = typeof data?.position === 'number' ? data.position : undefined;
                if (!toStageId) return;
                setCards((prev) => prev.map((c) => (
                    c.id === cardId
                        ? { ...c, stage_id: toStageId, position: position ?? c.position }
                        : c
                )));
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
                return;
            }
            if (type === 'card:abandoned' && cardId) {
                setCards((prev) => prev.filter((c) => c.id !== cardId));
                return;
            }
            if ((type === 'worktree:removed' || type === 'worktree:created') && cardId) {
                setWorktreeMeta((prev) => {
                    if (type === 'worktree:removed') {
                        if (!(cardId in prev)) return prev;
                        const next = { ...prev };
                        delete next[cardId];
                        return next;
                    }
                    return prev;
                });
                return;
            }
        });
        return () => es.close();
    }, [projectId]);

    return { cards, setCards, worktreeMeta, streamingCardIds, error, setError };
}
