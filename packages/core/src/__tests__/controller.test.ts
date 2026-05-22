import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';

// Each test file needs its own CONCERTO_HOME so getDb() reads/writes a fresh
// state.db without colliding with the user's real db or other suites.
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'concerto-ctrl-'));
process.env.CONCERTO_HOME = tmpRoot;

// Modules are loaded dynamically (after CONCERTO_HOME is set) since config.ts
// resolves the home path once at import time.
type Mod = {
    closeDb: typeof import('../db').closeDb;
    getDb: typeof import('../db').getDb;
    projects: typeof import('../projects');
    cards: typeof import('../cards');
    stages: typeof import('../stages');
    controller: typeof import('../controller');
};

let mod: Mod;

beforeAll(async () => {
    mod = {
        closeDb: (await import('../db')).closeDb,
        getDb: (await import('../db')).getDb,
        projects: await import('../projects'),
        cards: await import('../cards'),
        stages: await import('../stages'),
        controller: await import('../controller'),
    };
});

function git(cwd: string, args: string[]): string {
    return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function makeTmpRepo(): string {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'concerto-repo-'));
    git(repo, ['init', '-q', '-b', 'main']);
    git(repo, ['config', 'user.email', 'test@example.com']);
    git(repo, ['config', 'user.name', 'Test']);
    git(repo, ['config', 'commit.gpgsign', 'false']);
    fs.writeFileSync(path.join(repo, 'README.md'), '# repo\n');
    git(repo, ['add', '-A']);
    git(repo, ['commit', '-q', '-m', 'initial']);
    return repo;
}

interface Seeded {
    project: ReturnType<typeof import('../projects').createProject>;
    backlog: NonNullable<ReturnType<typeof import('../stages').getStage>>;
    active: NonNullable<ReturnType<typeof import('../stages').getStage>>;
    review: NonNullable<ReturnType<typeof import('../stages').getStage>>;
    done: NonNullable<ReturnType<typeof import('../stages').getStage>>;
    archive: NonNullable<ReturnType<typeof import('../stages').getStage>>;
}

function seedProject(): Seeded {
    const repo = makeTmpRepo();
    const project = mod.projects.createProject({ repo_path: repo, base_branch: 'main' });
    const all = mod.stages.listStages(project.id);
    return {
        project,
        backlog: mod.stages.findByKind(all, 'backlog')!,
        active: mod.stages.findByKind(all, 'active')!,
        review: mod.stages.findByKind(all, 'review')!,
        done: mod.stages.findByKind(all, 'done')!,
        archive: mod.stages.findByKind(all, 'archive')!,
    };
}

afterEach(() => {
    mod.closeDb();
    const dbFile = path.join(tmpRoot, 'state.db');
    for (const f of [dbFile, `${dbFile}-wal`, `${dbFile}-shm`]) {
        try { fs.rmSync(f); } catch {}
    }
});

describe('controller.parseActor', () => {
    it('returns the input when it is a known actor', () => {
        expect(mod.controller.parseActor('user', 'agent')).toBe('user');
        expect(mod.controller.parseActor('agent', 'user')).toBe('agent');
        expect(mod.controller.parseActor('system', 'user')).toBe('system');
    });
    it('falls back when input is not a known actor', () => {
        expect(mod.controller.parseActor(undefined, 'user')).toBe('user');
        expect(mod.controller.parseActor('bogus', 'agent')).toBe('agent');
        expect(mod.controller.parseActor(42, 'user')).toBe('user');
    });
});

describe('controller.requiresMergeEndpoint', () => {
    it('is true for archive', () => {
        expect(mod.controller.requiresMergeEndpoint('archive')).toBe(true);
    });
    it('is false for every other kind', () => {
        for (const k of ['backlog', 'ready', 'active', 'review', 'done'] as const) {
            expect(mod.controller.requiresMergeEndpoint(k)).toBe(false);
        }
    });
});

describe('controller.allowedTransitions', () => {
    let s: Seeded;
    beforeEach(() => { s = seedProject(); });

    it('omits archive for both actors', () => {
        const card = mod.cards.createCard({ project_id: s.project.id, title: 'omit-archive' });
        for (const actor of ['user', 'agent'] as const) {
            const ids = mod.controller.allowedTransitions(card, actor).map((st) => st.id);
            expect(ids).not.toContain(s.archive.id);
        }
    });

    it('omits done for agents, includes done for users from review', () => {
        const card = mod.cards.createCard({
            project_id: s.project.id,
            title: 'review-card',
            stage_id: s.review.id,
        });
        const userTargets = mod.controller.allowedTransitions(card, 'user').map((st) => st.id);
        const agentTargets = mod.controller.allowedTransitions(card, 'agent').map((st) => st.id);
        expect(userTargets).toContain(s.done.id);
        expect(agentTargets).not.toContain(s.done.id);
    });

    it('returns empty for cards already in archive', () => {
        const card = mod.cards.createCard({ project_id: s.project.id, title: 'gone' });
        mod.getDb().prepare('UPDATE cards SET stage_id = ? WHERE id = ?').run(s.archive.id, card.id);
        const reloaded = mod.cards.getCard(card.id)!;
        expect(mod.controller.allowedTransitions(reloaded, 'user')).toEqual([]);
    });
});

describe('controller.transition', () => {
    let s: Seeded;
    beforeEach(() => { s = seedProject(); });

    it('moves a card from backlog to active and creates a worktree', () => {
        const card = mod.cards.createCard({ project_id: s.project.id, title: 'ship-it' });
        const result = mod.controller.transition({
            cardId: card.id,
            toStageId: s.active.id,
            actor: 'user',
        });
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.card.stage_id).toBe(s.active.id);
            expect(result.card.branch_name).toBeTruthy();
            expect(result.card.worktree_path).toBeTruthy();
            expect(fs.existsSync(result.card.worktree_path!)).toBe(true);
        }
    });

    it('rejects an agent trying to move to done with done_requires_review_user', () => {
        const card = mod.cards.createCard({
            project_id: s.project.id,
            title: 'agent-promo',
            stage_id: s.review.id,
        });
        const result = mod.controller.transition({
            cardId: card.id,
            toStageId: s.done.id,
            actor: 'agent',
        });
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.code).toBe('done_requires_review_user');
            expect(result.allowed).not.toContain(s.done.id);
        }
    });

    it('rejects a direct transition to archive with archive_via_merge', () => {
        const card = mod.cards.createCard({
            project_id: s.project.id,
            title: 'no-direct-archive',
            stage_id: s.done.id,
        });
        const result = mod.controller.transition({
            cardId: card.id,
            toStageId: s.archive.id,
            actor: 'user',
        });
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.code).toBe('archive_via_merge');
            expect(result.hint).toMatch(/merge endpoint/);
        }
    });

    it('rejects any transition from archive with archive_immutable', () => {
        const card = mod.cards.createCard({ project_id: s.project.id, title: 'archived' });
        mod.getDb().prepare('UPDATE cards SET stage_id = ? WHERE id = ?').run(s.archive.id, card.id);
        const result = mod.controller.transition({
            cardId: card.id,
            toStageId: s.backlog.id,
            actor: 'user',
        });
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.code).toBe('archive_immutable');
    });
});

describe('controller.canMerge', () => {
    let s: Seeded;
    beforeEach(() => { s = seedProject(); });

    it('rejects when source is not done-kind', () => {
        const card = mod.cards.createCard({ project_id: s.project.id, title: 'too-early' });
        const result = mod.controller.canMerge(card);
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.code).toBe('merge_requires_done');
    });

    it('rejects when card has no worktree', () => {
        const card = mod.cards.createCard({
            project_id: s.project.id,
            title: 'no-wt',
            stage_id: s.done.id,
        });
        const result = mod.controller.canMerge(card);
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.code).toBe('no_worktree');
    });
});

describe('controller.canAbandon', () => {
    let s: Seeded;
    beforeEach(() => { s = seedProject(); });

    it('rejects archived cards', () => {
        const card = mod.cards.createCard({ project_id: s.project.id, title: 'merged' });
        mod.getDb().prepare('UPDATE cards SET stage_id = ? WHERE id = ?').run(s.archive.id, card.id);
        const reloaded = mod.cards.getCard(card.id)!;
        const result = mod.controller.canAbandon(reloaded);
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.code).toBe('archive_immutable');
    });

    it('accepts a backlog card', () => {
        const card = mod.cards.createCard({ project_id: s.project.id, title: 'still-here' });
        const result = mod.controller.canAbandon(card);
        expect(result.ok).toBe(true);
    });
});

describe('cards.canDelete', () => {
    let s: Seeded;
    beforeEach(() => { s = seedProject(); });

    it('accepts a backlog card', () => {
        const card = mod.cards.createCard({ project_id: s.project.id, title: 'fresh' });
        const result = mod.cards.canDelete(card.id);
        expect(result.ok).toBe(true);
    });

    it('rejects a card in a non-backlog stage and lists backlog targets', () => {
        const card = mod.cards.createCard({
            project_id: s.project.id,
            title: 'in-progress',
            stage_id: s.active.id,
        });
        const result = mod.cards.canDelete(card.id);
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.allowed).toContain(s.backlog.id);
    });
});
