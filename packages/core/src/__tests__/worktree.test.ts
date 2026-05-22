import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'coro-wt-'));
process.env.CORO_HOME = tmpRoot;

type Mod = {
    closeDb: typeof import('../db').closeDb;
    getDb: typeof import('../db').getDb;
    projects: typeof import('../projects');
    cards: typeof import('../cards');
    worktree: typeof import('../worktree');
};

let mod: Mod;

beforeAll(async () => {
    mod = {
        closeDb: (await import('../db')).closeDb,
        getDb: (await import('../db')).getDb,
        projects: await import('../projects'),
        cards: await import('../cards'),
        worktree: await import('../worktree'),
    };
});

function git(cwd: string, args: string[]): string {
    return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function makeTmpRepo(): string {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'coro-wt-repo-'));
    git(repo, ['init', '-q', '-b', 'main']);
    git(repo, ['config', 'user.email', 'test@example.com']);
    git(repo, ['config', 'user.name', 'Test']);
    git(repo, ['config', 'commit.gpgsign', 'false']);
    fs.writeFileSync(path.join(repo, 'README.md'), '# repo\n');
    git(repo, ['add', '-A']);
    git(repo, ['commit', '-q', '-m', 'initial']);
    return repo;
}

function writeAndCommit(repo: string, file: string, content: string, msg: string): string {
    fs.writeFileSync(path.join(repo, file), content);
    git(repo, ['add', '-A']);
    git(repo, ['commit', '-q', '-m', msg]);
    return git(repo, ['rev-parse', 'HEAD']);
}

afterEach(() => {
    mod.closeDb();
    const dbFile = path.join(tmpRoot, 'state.db');
    for (const f of [dbFile, `${dbFile}-wal`, `${dbFile}-shm`]) {
        try { fs.rmSync(f); } catch {}
    }
});

describe('worktree.createWorktree', () => {
    let repo: string;
    let project: ReturnType<typeof import('../projects').createProject>;
    let card: ReturnType<typeof import('../cards').createCard>;

    beforeEach(() => {
        repo = makeTmpRepo();
        project = mod.projects.createProject({ repo_path: repo, base_branch: 'main' });
        card = mod.cards.createCard({ project_id: project.id, title: 'first card' });
    });

    it('creates a worktree on disk and a DB row', () => {
        const wt = mod.worktree.createWorktree({
            cardId: card.id,
            slug: card.slug,
            repoPath: repo,
            baseBranch: 'main',
        });
        expect(fs.existsSync(wt.path)).toBe(true);
        expect(fs.existsSync(path.join(wt.path, 'README.md'))).toBe(true);
        expect(wt.branch).toMatch(/^coro\//);
        const row = mod.worktree.getWorktreeByCard(card.id);
        expect(row).toBeTruthy();
        expect(row!.path).toBe(wt.path);
        expect(row!.state).toBe('active');
    });

    it('returns the existing active worktree on a second call', () => {
        const first = mod.worktree.createWorktree({
            cardId: card.id, slug: card.slug, repoPath: repo, baseBranch: 'main',
        });
        const second = mod.worktree.createWorktree({
            cardId: card.id, slug: card.slug, repoPath: repo, baseBranch: 'main',
        });
        expect(second.id).toBe(first.id);
        expect(second.path).toBe(first.path);
    });

    it('installs a pre-push hook that refuses to push the agent branch', () => {
        const wt = mod.worktree.createWorktree({
            cardId: card.id, slug: card.slug, repoPath: repo, baseBranch: 'main',
        });
        // Set up a bare repo as a fake remote so `git push` has somewhere to go.
        const remote = fs.mkdtempSync(path.join(os.tmpdir(), 'coro-wt-remote-'));
        git(remote, ['init', '--bare', '-q', '-b', 'main']);
        git(wt.path, ['remote', 'add', 'origin', remote]);
        let err: any;
        try {
            execFileSync('git', ['-C', wt.path, 'push', 'origin', 'HEAD'], { encoding: 'utf8' });
        } catch (e) { err = e; }
        expect(err).toBeTruthy();
        const stderr = err.stderr?.toString() || '';
        expect(stderr).toMatch(/coro: agent worktree/);
        expect(stderr).toContain(card.id);
    });

    it('stamps Coro-Card-Id trailer on every commit', () => {
        const wt = mod.worktree.createWorktree({
            cardId: card.id, slug: card.slug, repoPath: repo, baseBranch: 'main',
        });
        // Inherit committer identity from outer test setup; worktrees share it.
        git(wt.path, ['config', 'user.email', 'agent@example.com']);
        git(wt.path, ['config', 'user.name', 'Agent']);
        git(wt.path, ['config', 'commit.gpgsign', 'false']);
        fs.writeFileSync(path.join(wt.path, 'note.md'), '# note\n');
        git(wt.path, ['add', '-A']);
        git(wt.path, ['commit', '-q', '-m', 'add note']);
        const trailers = git(wt.path, ['log', '-1', '--pretty=%(trailers:only)']);
        expect(trailers).toContain(`Coro-Card-Id: ${card.id}`);
    });

    it('is idempotent when a commit already carries the trailer', () => {
        const wt = mod.worktree.createWorktree({
            cardId: card.id, slug: card.slug, repoPath: repo, baseBranch: 'main',
        });
        git(wt.path, ['config', 'user.email', 'agent@example.com']);
        git(wt.path, ['config', 'user.name', 'Agent']);
        git(wt.path, ['config', 'commit.gpgsign', 'false']);
        fs.writeFileSync(path.join(wt.path, 'a.md'), 'a\n');
        git(wt.path, ['add', '-A']);
        git(wt.path, ['commit', '-q', '-m', `add a\n\nCoro-Card-Id: ${card.id}\n`]);
        const trailers = git(wt.path, ['log', '-1', '--pretty=%(trailers:only)']);
        // Trailer present exactly once.
        const matches = trailers.match(new RegExp(`Coro-Card-Id: ${card.id}`, 'g')) || [];
        expect(matches.length).toBe(1);
    });

    it('leaves the main repo hooks untouched', () => {
        mod.worktree.createWorktree({
            cardId: card.id, slug: card.slug, repoPath: repo, baseBranch: 'main',
        });
        // The main repo gets extensions.worktreeConfig=true but no hook files.
        const ext = git(repo, ['config', '--get', 'extensions.worktreeConfig']);
        expect(ext).toBe('true');
        const mainHooksPath = path.join(repo, '.git', 'hooks', 'pre-push');
        expect(fs.existsSync(mainHooksPath)).toBe(false);
    });
});

describe('worktree.precheckMerge', () => {
    let repo: string;
    let project: ReturnType<typeof import('../projects').createProject>;

    beforeEach(() => {
        repo = makeTmpRepo();
        project = mod.projects.createProject({ repo_path: repo, base_branch: 'main' });
    });

    it('reports no conflicts and not-already-merged for a clean branch', () => {
        const card = mod.cards.createCard({ project_id: project.id, title: 'clean' });
        const wt = mod.worktree.createWorktree({
            cardId: card.id, slug: card.slug, repoPath: repo, baseBranch: 'main',
        });
        writeAndCommit(wt.path, 'NEW_FILE.md', '# new\n', 'add new');
        const pre = mod.worktree.precheckMerge(repo, 'main', wt.branch);
        expect(pre.conflicts).toEqual([]);
        expect(pre.alreadyMerged).toBe(false);
    });

    it('reports already_merged when the branch is an ancestor of base', () => {
        const card = mod.cards.createCard({ project_id: project.id, title: 'ancestor' });
        const wt = mod.worktree.createWorktree({
            cardId: card.id, slug: card.slug, repoPath: repo, baseBranch: 'main',
        });
        // Branch is at the same SHA as main → trivially an ancestor.
        const pre = mod.worktree.precheckMerge(repo, 'main', wt.branch);
        expect(pre.alreadyMerged).toBe(true);
        expect(pre.conflicts).toEqual([]);
    });

    it('lists conflicting paths when base and branch touch the same lines', () => {
        const card = mod.cards.createCard({ project_id: project.id, title: 'conflict' });
        const wt = mod.worktree.createWorktree({
            cardId: card.id, slug: card.slug, repoPath: repo, baseBranch: 'main',
        });
        // Both base and branch edit the same line in README.md.
        writeAndCommit(wt.path, 'README.md', '# repo - branch edit\n', 'branch change');
        writeAndCommit(repo, 'README.md', '# repo - main edit\n', 'main change');
        const pre = mod.worktree.precheckMerge(repo, 'main', wt.branch);
        expect(pre.conflicts).toContain('README.md');
    });
});

describe('worktree.performMerge', () => {
    let repo: string;
    let project: ReturnType<typeof import('../projects').createProject>;

    beforeEach(() => {
        repo = makeTmpRepo();
        project = mod.projects.createProject({ repo_path: repo, base_branch: 'main' });
    });

    it('advances HEAD on base when squashing a clean branch', () => {
        const card = mod.cards.createCard({ project_id: project.id, title: 'happy' });
        const wt = mod.worktree.createWorktree({
            cardId: card.id, slug: card.slug, repoPath: repo, baseBranch: 'main',
        });
        const baseBefore = git(repo, ['rev-parse', 'main']);
        writeAndCommit(wt.path, 'feature.md', '# feature\n', 'add feature');
        const pre = mod.worktree.precheckMerge(repo, 'main', wt.branch);
        const result = mod.worktree.performMerge(repo, 'main', wt.branch, 'squash', 'land feature', pre);
        const baseAfter = git(repo, ['rev-parse', 'main']);
        expect(result.alreadyMerged).toBe(false);
        expect(baseAfter).toBe(result.mergeSha);
        expect(baseAfter).not.toBe(baseBefore);
        // Squash → single parent (base only).
        const parents = git(repo, ['rev-list', '--parents', '-n', '1', result.mergeSha]).split(/\s+/);
        expect(parents.length).toBe(2); // commit + 1 parent
        expect(parents[1]).toBe(baseBefore);
    });

    it('is a no-op when the branch is already an ancestor of base', () => {
        const card = mod.cards.createCard({ project_id: project.id, title: 'noop' });
        const wt = mod.worktree.createWorktree({
            cardId: card.id, slug: card.slug, repoPath: repo, baseBranch: 'main',
        });
        const baseBefore = git(repo, ['rev-parse', 'main']);
        const result = mod.worktree.performMerge(repo, 'main', wt.branch, 'squash', 'noop', undefined);
        expect(result.alreadyMerged).toBe(true);
        expect(result.mergeSha).toBe(baseBefore);
        expect(git(repo, ['rev-parse', 'main'])).toBe(baseBefore);
    });

    it('fails the update-ref CAS when base moves between precheck and merge', () => {
        const card = mod.cards.createCard({ project_id: project.id, title: 'cas' });
        const wt = mod.worktree.createWorktree({
            cardId: card.id, slug: card.slug, repoPath: repo, baseBranch: 'main',
        });
        writeAndCommit(wt.path, 'side.md', '# side\n', 'side commit');
        const pre = mod.worktree.precheckMerge(repo, 'main', wt.branch);
        // Race: someone else lands a non-conflicting commit on main after our precheck.
        writeAndCommit(repo, 'other.md', '# other\n', 'concurrent main commit');
        expect(() =>
            mod.worktree.performMerge(repo, 'main', wt.branch, 'squash', 'msg', pre),
        ).toThrow();
    });
});
