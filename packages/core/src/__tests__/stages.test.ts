import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'coro-stages-'));
process.env.CORO_HOME = tmpRoot;

type Mod = {
    closeDb: typeof import('../db').closeDb;
    getDb: typeof import('../db').getDb;
    projects: typeof import('../projects');
    cards: typeof import('../cards');
    stages: typeof import('../stages');
};

let mod: Mod;

beforeAll(async () => {
    mod = {
        closeDb: (await import('../db')).closeDb,
        getDb: (await import('../db')).getDb,
        projects: await import('../projects'),
        cards: await import('../cards'),
        stages: await import('../stages'),
    };
});

function git(cwd: string, args: string[]): string {
    return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function makeTmpRepo(): string {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'coro-stages-repo-'));
    git(repo, ['init', '-q', '-b', 'main']);
    git(repo, ['config', 'user.email', 'test@example.com']);
    git(repo, ['config', 'user.name', 'Test']);
    git(repo, ['config', 'commit.gpgsign', 'false']);
    fs.writeFileSync(path.join(repo, 'README.md'), '# repo\n');
    git(repo, ['add', '-A']);
    git(repo, ['commit', '-q', '-m', 'initial']);
    return repo;
}

function newProject() {
    return mod.projects.createProject({ repo_path: makeTmpRepo(), base_branch: 'main' });
}

afterEach(() => {
    mod.closeDb();
    const dbFile = path.join(tmpRoot, 'state.db');
    for (const f of [dbFile, `${dbFile}-wal`, `${dbFile}-shm`]) {
        try { fs.rmSync(f); } catch {}
    }
});

beforeEach(() => {
    mod.getDb();
});

describe('replaceStages', () => {
    it('renames a stage while cards exist', () => {
        const project = newProject();
        const stages = mod.stages.listStages(project.id);
        const backlog = stages.find((s) => s.kind === 'backlog')!;
        mod.cards.createCard({ project_id: project.id, title: 'a card', stage_id: backlog.id });

        const result = mod.stages.replaceStages(
            project.id,
            stages.map((s) => ({ id: s.id, name: s.id === backlog.id ? 'Inbox' : s.name, kind: s.kind })),
        );
        expect(result.ok).toBe(true);
        const after = mod.stages.listStages(project.id);
        expect(after.find((s) => s.id === backlog.id)?.name).toBe('Inbox');
    });

    it('reorders stages while cards exist', () => {
        const project = newProject();
        const stages = mod.stages.listStages(project.id);
        const reversed = [...stages].reverse();
        const backlog = stages.find((s) => s.kind === 'backlog')!;
        mod.cards.createCard({ project_id: project.id, title: 'a card', stage_id: backlog.id });

        const result = mod.stages.replaceStages(
            project.id,
            reversed.map((s) => ({ id: s.id, name: s.name, kind: s.kind })),
        );
        expect(result.ok).toBe(true);
        const after = mod.stages.listStages(project.id);
        expect(after.map((s) => s.id)).toEqual(reversed.map((s) => s.id));
    });

    it('changes a stage kind while cards exist', () => {
        const project = newProject();
        const stages = mod.stages.listStages(project.id);
        const testing = stages.find((s) => s.name === 'Testing')!; // default has two `active` stages
        const backlog = stages.find((s) => s.kind === 'backlog')!;
        mod.cards.createCard({ project_id: project.id, title: 'a card', stage_id: backlog.id });

        const result = mod.stages.replaceStages(
            project.id,
            stages.map((s) => ({ id: s.id, name: s.name, kind: s.id === testing.id ? 'review' : s.kind })),
        );
        expect(result.ok).toBe(true);
        expect(mod.stages.getStage(testing.id)!.kind).toBe('review');
    });

    it('adds a new stage while cards exist', () => {
        const project = newProject();
        const stages = mod.stages.listStages(project.id);
        const backlog = stages.find((s) => s.kind === 'backlog')!;
        mod.cards.createCard({ project_id: project.id, title: 'a card', stage_id: backlog.id });

        const result = mod.stages.replaceStages(
            project.id,
            [
                ...stages.map((s) => ({ id: s.id, name: s.name, kind: s.kind })),
                { name: 'Staging', kind: 'active' as const },
            ],
        );
        expect(result.ok).toBe(true);
        const after = mod.stages.listStages(project.id);
        expect(after.find((s) => s.name === 'Staging')?.kind).toBe('active');
    });

    it('removes an empty stage while another stage has cards', () => {
        const project = newProject();
        const stages = mod.stages.listStages(project.id);
        const backlog = stages.find((s) => s.kind === 'backlog')!;
        const testing = stages.find((s) => s.name === 'Testing')!;
        mod.cards.createCard({ project_id: project.id, title: 'a card', stage_id: backlog.id });

        const result = mod.stages.replaceStages(
            project.id,
            stages.filter((s) => s.id !== testing.id).map((s) => ({ id: s.id, name: s.name, kind: s.kind })),
        );
        expect(result.ok).toBe(true);
        expect(mod.stages.getStage(testing.id)).toBeNull();
    });

    it('refuses to remove a stage with cards', () => {
        const project = newProject();
        const stages = mod.stages.listStages(project.id);
        const backlog = stages.find((s) => s.kind === 'backlog')!;
        const extraBacklog = mod.stages.replaceStages(
            project.id,
            [
                ...stages.map((s) => ({ id: s.id, name: s.name, kind: s.kind })),
                { name: 'Inbox 2', kind: 'backlog' as const },
            ],
        );
        expect(extraBacklog.ok).toBe(true);
        mod.cards.createCard({ project_id: project.id, title: 'a card', stage_id: backlog.id });

        const after = mod.stages.listStages(project.id);
        const result = mod.stages.replaceStages(
            project.id,
            after.filter((s) => s.id !== backlog.id).map((s) => ({ id: s.id, name: s.name, kind: s.kind })),
        );
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.reason).toMatch(/cannot remove/i);
        expect(mod.stages.getStage(backlog.id)).not.toBeNull();
    });

    it('refuses unknown stage id', () => {
        const project = newProject();
        const stages = mod.stages.listStages(project.id);
        const result = mod.stages.replaceStages(
            project.id,
            stages.map((s, i) => ({ id: i === 0 ? 'bogus-id' : s.id, name: s.name, kind: s.kind })),
        );
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.reason).toMatch(/unknown stage id/i);
    });

    it('refuses missing required kind', () => {
        const project = newProject();
        const stages = mod.stages.listStages(project.id);
        const result = mod.stages.replaceStages(
            project.id,
            stages.filter((s) => s.kind !== 'archive').map((s) => ({ id: s.id, name: s.name, kind: s.kind })),
        );
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.reason).toMatch(/missing required kind/i);
    });

    it('preserves created_at on rename', () => {
        const project = newProject();
        const stages = mod.stages.listStages(project.id);
        const backlog = stages.find((s) => s.kind === 'backlog')!;
        const originalCreatedAt = backlog.created_at;

        const result = mod.stages.replaceStages(
            project.id,
            stages.map((s) => ({ id: s.id, name: s.id === backlog.id ? 'Inbox' : s.name, kind: s.kind })),
        );
        expect(result.ok).toBe(true);
        expect(mod.stages.getStage(backlog.id)!.created_at).toBe(originalCreatedAt);
    });
});
