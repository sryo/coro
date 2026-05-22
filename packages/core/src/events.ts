import type { EventKind, EventActor } from '@concerto/types';
import { getDb } from './db';

export type { EventKind, EventActor } from '@concerto/types';

type EventListener = (type: string, data: Record<string, unknown>) => void;

const listeners: EventListener[] = [];

export function onEvent(listener: EventListener): () => void {
    listeners.push(listener);
    return () => {
        const i = listeners.indexOf(listener);
        if (i >= 0) listeners.splice(i, 1);
    };
}

export function emitEvent(type: string, data: Record<string, unknown>): void {
    for (const listener of listeners) {
        try {
            listener(type, data);
        } catch {
            // never let a misbehaving listener crash the emitter
        }
    }
}

export interface RecordCardEventInput {
    cardId: string;
    projectId: string;
    kind: EventKind;
    actor: EventActor;
    payload: Record<string, unknown>;
    at?: number;
}

export function recordCardEvent(input: RecordCardEventInput): number {
    const now = input.at ?? Date.now();
    getDb().prepare(`
        INSERT INTO events (card_id, project_id, kind, actor, payload_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
    `).run(input.cardId, input.projectId, input.kind, input.actor, JSON.stringify(input.payload), now);
    return now;
}
