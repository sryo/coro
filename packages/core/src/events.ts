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

export interface CreateCardEventInput {
    cardId: string;
    projectId: string;
    kind: EventKind;
    actor: EventActor;
    payload: Record<string, unknown>;
    /** SSE event name. Defaults to `card:<kind>`. */
    event?: string;
    /** Extra fields to merge into the SSE payload; card_id + project_id are added automatically. */
    emitPayload?: Record<string, unknown>;
    at?: number;
}

/**
 * INSERT a card event into the events table AND emit it on the SSE bus in one
 * call. Replaces the old recordCardEvent + emitEvent pair that all five callers
 * had to remember to invoke together.
 */
export function createCardEvent(input: CreateCardEventInput): number {
    const now = input.at ?? Date.now();
    getDb().prepare(`
        INSERT INTO events (card_id, project_id, kind, actor, payload_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
    `).run(input.cardId, input.projectId, input.kind, input.actor, JSON.stringify(input.payload), now);

    const eventName = input.event ?? `card:${input.kind}`;
    const emitBody: Record<string, unknown> = {
        card_id: input.cardId,
        project_id: input.projectId,
        actor: input.actor,
        at: now,
        ...(input.emitPayload || {}),
    };
    emitEvent(eventName, emitBody);
    return now;
}
