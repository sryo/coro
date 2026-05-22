import { nanoid } from 'nanoid';
import type { Stage, StageKind } from '@coro/types';
import { getDb } from './db';

export type { Stage, StageKind } from '@coro/types';

export interface StageInput {
    id?: string;
    name: string;
    kind: StageKind;
}

const VALID_KINDS: ReadonlySet<StageKind> = new Set([
    'backlog', 'ready', 'active', 'review', 'done', 'archive',
]);

export function listStages(projectId: string): Stage[] {
    return getDb()
        .prepare('SELECT * FROM stages WHERE project_id = ? ORDER BY position ASC')
        .all(projectId) as Stage[];
}

export function getStage(id: string): Stage | null {
    const row = getDb()
        .prepare('SELECT * FROM stages WHERE id = ?')
        .get(id) as Stage | undefined;
    return row || null;
}

export function getStageByName(projectId: string, name: string): Stage | null {
    const row = getDb()
        .prepare('SELECT * FROM stages WHERE project_id = ? AND name = ?')
        .get(projectId, name) as Stage | undefined;
    return row || null;
}

export function getDefaultStage(projectId: string): Stage {
    const all = listStages(projectId);
    return findByKind(all, 'backlog') || all[0];
}

export function findByKind(stages: Stage[], kind: StageKind): Stage | null {
    return stages.find((s) => s.kind === kind) || null;
}

export function filterByKind(stages: Stage[], kind: StageKind): Stage[] {
    return stages.filter((s) => s.kind === kind);
}

/**
 * Replace all stages for a project. Validates the new set:
 * - at least one of each load-bearing kind: backlog, active, review, archive
 * - names unique
 * - positions assigned by array order
 *
 * Diffs old vs new by id. Refuses only the operation that would orphan a card:
 * removing a stage that still has cards in it. Renames, reorders, kind changes,
 * adds, and removing-an-empty-stage all proceed.
 */
export function replaceStages(projectId: string, stages: StageInput[]): { ok: true } | { ok: false; reason: string } {
    if (stages.length === 0) return { ok: false, reason: 'at least one stage required' };
    for (const s of stages) {
        if (!VALID_KINDS.has(s.kind)) return { ok: false, reason: `invalid kind: ${s.kind}` };
    }
    const required: StageKind[] = ['backlog', 'active', 'review', 'archive'];
    for (const req of required) {
        if (!stages.find(s => s.kind === req)) return { ok: false, reason: `missing required kind: ${req}` };
    }
    const names = new Set<string>();
    for (const s of stages) {
        if (names.has(s.name)) return { ok: false, reason: `duplicate name: ${s.name}` };
        names.add(s.name);
    }

    const db = getDb();
    const existing = listStages(projectId);
    const existingById = new Map(existing.map((s) => [s.id, s]));
    const submittedIds = new Set(stages.map((s) => s.id).filter((id): id is string => !!id));

    for (const s of stages) {
        if (s.id && !existingById.has(s.id)) return { ok: false, reason: `unknown stage id: ${s.id}` };
    }

    const removedIds = [...existingById.keys()].filter((id) => !submittedIds.has(id));
    for (const id of removedIds) {
        const n = (db.prepare('SELECT COUNT(*) as n FROM cards WHERE stage_id = ?').get(id) as { n: number }).n;
        if (n > 0) {
            const stage = existingById.get(id)!;
            return { ok: false, reason: `cannot remove stage '${stage.name}': ${n} card(s) still in it` };
        }
    }

    const tx = db.transaction(() => {
        if (removedIds.length > 0) {
            const placeholders = removedIds.map(() => '?').join(',');
            db.prepare(`DELETE FROM stages WHERE id IN (${placeholders})`).run(...removedIds);
        }
        // UNIQUE(project_id, position) means a straight UPDATE pass can collide
        // mid-reorder. Park preserved stages at high offsets first, then settle.
        const POSITION_PARK = 1_000_000;
        const parkPosition = db.prepare('UPDATE stages SET position = ? WHERE id = ?');
        existing.forEach((s, i) => {
            if (submittedIds.has(s.id)) parkPosition.run(POSITION_PARK + i, s.id);
        });
        const update = db.prepare('UPDATE stages SET name = ?, position = ?, kind = ? WHERE id = ?');
        const insert = db.prepare(
            'INSERT INTO stages (id, project_id, name, position, kind, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        );
        const now = Date.now();
        stages.forEach((s, position) => {
            if (s.id && existingById.has(s.id)) {
                update.run(s.name, position, s.kind, s.id);
            } else {
                insert.run(s.id || nanoid(8), projectId, s.name, position, s.kind, now);
            }
        });
    });
    tx();

    return { ok: true };
}
