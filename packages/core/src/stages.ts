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
 * Cards referencing removed stages would be orphaned, so we refuse if any exist.
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
    const cardCount = (db.prepare('SELECT COUNT(*) as n FROM cards WHERE project_id = ?').get(projectId) as { n: number }).n;
    if (cardCount > 0) {
        return { ok: false, reason: 'cannot replace stages while cards exist (v0 limit; v1 will support remap)' };
    }

    const tx = db.transaction(() => {
        db.prepare('DELETE FROM stages WHERE project_id = ?').run(projectId);
        const insert = db.prepare(`
            INSERT INTO stages (id, project_id, name, position, kind, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
        `);
        const now = Date.now();
        stages.forEach((s, position) => {
            insert.run(s.id || nanoid(8), projectId, s.name, position, s.kind, now);
        });
    });
    tx();

    return { ok: true };
}
