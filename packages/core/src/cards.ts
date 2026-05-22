import { nanoid } from 'nanoid';
import type { Card } from '@coro/types';
import { getDb } from './db';
import { slugify } from './slug';
import { getDefaultStage, getStage, listStages, filterByKind } from './stages';
import { emitEvent } from './events';

export type { Card } from '@coro/types';

export type CanDeleteResult =
    | { ok: true }
    | { ok: false; reason: string; allowed: string[] };

/**
 * Check whether a card may be deleted. Cards outside backlog kind stages must
 * go through abandon instead (so their worktree is dealt with). Returns the
 * list of legal backlog stage ids so callers can hint where to move first.
 */
export function canDelete(cardId: string): CanDeleteResult {
    const card = getCard(cardId);
    if (!card) return { ok: false, reason: 'card not found', allowed: [] };
    const stage = getStage(card.stage_id);
    const projectStages = listStages(card.project_id);
    const allowed = filterByKind(projectStages, 'backlog').map((s) => s.id);
    if (!stage || stage.kind === 'backlog') return { ok: true };
    return {
        ok: false,
        reason: 'cannot delete card outside backlog; use abandon instead',
        allowed,
    };
}

export interface CreateCardInput {
    project_id: string;
    title: string;
    description?: string;
    stage_id?: string;
    model_override?: string;
}

export function getCard(id: string): Card | null {
    const row = getDb().prepare('SELECT * FROM cards WHERE id = ?').get(id) as Card | undefined;
    return row || null;
}

export function listCards(projectId: string, stageId?: string): Card[] {
    if (stageId) {
        return getDb()
            .prepare('SELECT * FROM cards WHERE project_id = ? AND stage_id = ? ORDER BY position ASC')
            .all(projectId, stageId) as Card[];
    }
    return getDb()
        .prepare('SELECT * FROM cards WHERE project_id = ? ORDER BY stage_id, position ASC')
        .all(projectId) as Card[];
}

export function createCard(input: CreateCardInput): Card {
    const stage = input.stage_id ? getStage(input.stage_id) : getDefaultStage(input.project_id);
    if (!stage) throw new Error('stage not found');
    if (stage.project_id !== input.project_id) throw new Error('stage belongs to a different project');

    const db = getDb();
    const id = nanoid(10);
    const now = Date.now();
    const slug = slugify(input.title);

    // Atomic MAX+1 + INSERT so two concurrent createCard calls into the same stage
    // can't land on the same position. SQLite serializes the transaction.
    const tx = db.transaction(() => {
        const maxRow = db
            .prepare('SELECT COALESCE(MAX(position), -1) AS max FROM cards WHERE project_id = ? AND stage_id = ?')
            .get(input.project_id, stage.id) as { max: number };
        const position = maxRow.max + 1;
        db.prepare(`
            INSERT INTO cards (
                id, project_id, slug, title, description, stage_id,
                position, created_at, updated_at, model_override
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            id,
            input.project_id,
            slug,
            input.title,
            input.description ?? null,
            stage.id,
            position,
            now,
            now,
            input.model_override ?? null,
        );
    });
    tx();

    const card = getCard(id)!;
    emitEvent('card:created', { card_id: id, project_id: input.project_id });
    return card;
}

export function updateCard(
    id: string,
    patch: Partial<Pick<Card, 'title' | 'description' | 'position' | 'model_override'>>,
): Card | null {
    const fields: string[] = [];
    const values: unknown[] = [];
    for (const [k, v] of Object.entries(patch)) {
        if (v !== undefined) {
            fields.push(`${k} = ?`);
            values.push(v);
        }
    }
    if (patch.title !== undefined) {
        fields.push('slug = ?');
        values.push(slugify(patch.title));
    }
    if (fields.length === 0) return getCard(id);
    fields.push('updated_at = ?');
    values.push(Date.now());
    values.push(id);
    getDb().prepare(`UPDATE cards SET ${fields.join(', ')} WHERE id = ?`).run(...values);
    return getCard(id);
}

export function deleteCard(id: string): boolean {
    const card = getCard(id);
    if (!card) return false;
    const check = canDelete(id);
    if (!check.ok) {
        throw Object.assign(new Error(check.reason), {
            code: 'invalid_state',
            allowed: check.allowed,
        });
    }
    getDb().prepare('DELETE FROM cards WHERE id = ?').run(id);
    emitEvent('card:deleted', { card_id: id, project_id: card.project_id });
    return true;
}
