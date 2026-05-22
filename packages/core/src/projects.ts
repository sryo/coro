import path from 'path';
import { execFileSync } from 'child_process';
import { nanoid } from 'nanoid';
import type { Project } from '@coro/types';
import { getDb } from './db';
import { DEFAULT_STAGES } from './config';

export type { Project } from '@coro/types';

export interface CreateProjectInput {
    name?: string;
    repo_path: string;
    base_branch?: string;
}

export function getProjectByPath(repoPath: string): Project | null {
    const row = getDb()
        .prepare('SELECT * FROM projects WHERE repo_path = ?')
        .get(repoPath) as Project | undefined;
    return row || null;
}

export function getProject(id: string): Project | null {
    const row = getDb()
        .prepare('SELECT * FROM projects WHERE id = ?')
        .get(id) as Project | undefined;
    return row || null;
}

export function listProjects(): Project[] {
    return getDb()
        .prepare('SELECT * FROM projects ORDER BY created_at DESC')
        .all() as Project[];
}

/** Same as listProjects(), but each row carries card_count and last_activity_at
 * (derived from MAX(cards.updated_at) per project). Used by the dashboard's
 * project switcher and index page. */
export function listProjectsWithCounts(): Project[] {
    const db = getDb();
    const base = listProjects();
    const stats = db
        .prepare(
            'SELECT project_id, COUNT(*) AS n, MAX(updated_at) AS last_at FROM cards GROUP BY project_id',
        )
        .all() as Array<{ project_id: string; n: number; last_at: number | null }>;
    const byId = new Map(stats.map((s) => [s.project_id, s]));
    return base.map((p) => ({
        ...p,
        card_count: byId.get(p.id)?.n ?? 0,
        last_activity_at: byId.get(p.id)?.last_at ?? null,
    }));
}

export function createProject(input: CreateProjectInput): Project {
    const db = getDb();
    const id = nanoid(10);
    const name = input.name || path.basename(input.repo_path);
    const baseBranch = input.base_branch || 'main';
    const now = Date.now();

    const tx = db.transaction(() => {
        db.prepare(`
            INSERT INTO projects (id, name, repo_path, base_branch, settings_json, created_at)
            VALUES (?, ?, ?, ?, '{}', ?)
        `).run(id, name, input.repo_path, baseBranch, now);

        const insertStage = db.prepare(`
            INSERT INTO stages (id, project_id, name, position, kind, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
        `);
        DEFAULT_STAGES.forEach((s, position) => {
            insertStage.run(nanoid(8), id, s.name, position, s.kind, now);
        });
    });
    tx();

    return getProject(id)!;
}

export class UpdateProjectError extends Error {
    constructor(message: string, public code: string) {
        super(message);
    }
}

/** Checks whether a branch exists locally in the project's repo. */
export function branchExists(repoPath: string, branch: string): boolean {
    try {
        execFileSync('git', ['-C', repoPath, 'show-ref', '--verify', '--quiet', `refs/heads/${branch}`]);
        return true;
    } catch {
        return false;
    }
}

export function updateProject(
    id: string,
    patch: Partial<Pick<Project, 'name' | 'base_branch' | 'default_model' | 'project_brief' | 'settings_json'>>,
): Project | null {
    const existing = getProject(id);
    if (!existing) return null;
    if (patch.base_branch !== undefined && patch.base_branch !== existing.base_branch) {
        if (!branchExists(existing.repo_path, patch.base_branch)) {
            throw new UpdateProjectError(`branch '${patch.base_branch}' does not exist in ${existing.repo_path}`, 'invalid_branch');
        }
    }
    const fields: string[] = [];
    const values: unknown[] = [];
    for (const [k, v] of Object.entries(patch)) {
        if (v !== undefined) {
            fields.push(`${k} = ?`);
            values.push(v);
        }
    }
    if (fields.length === 0) return existing;
    values.push(id);
    getDb().prepare(`UPDATE projects SET ${fields.join(', ')} WHERE id = ?`).run(...values);
    return getProject(id);
}

/** Hard-delete a project. Cascade drops stages, cards, worktrees rows, conversations,
 * messages, events. Worktree directories on disk are NOT touched — the user should
 * abandon cards first if they want cleanup. */
export function deleteProject(id: string): boolean {
    const result = getDb().prepare('DELETE FROM projects WHERE id = ?').run(id);
    return result.changes > 0;
}
