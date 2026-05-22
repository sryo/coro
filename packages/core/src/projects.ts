import path from 'path';
import { nanoid } from 'nanoid';
import type { Project } from '@concerto/types';
import { getDb } from './db';
import { DEFAULT_STAGES } from './config';

export type { Project } from '@concerto/types';

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

export function updateProject(
    id: string,
    patch: Partial<Pick<Project, 'name' | 'base_branch' | 'default_model' | 'project_brief' | 'settings_json'>>,
): Project | null {
    const fields: string[] = [];
    const values: unknown[] = [];
    for (const [k, v] of Object.entries(patch)) {
        if (v !== undefined) {
            fields.push(`${k} = ?`);
            values.push(v);
        }
    }
    if (fields.length === 0) return getProject(id);
    values.push(id);
    getDb().prepare(`UPDATE projects SET ${fields.join(', ')} WHERE id = ?`).run(...values);
    return getProject(id);
}
