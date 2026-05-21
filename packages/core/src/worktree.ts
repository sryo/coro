import path from 'path';
import fs from 'fs';
import { execFileSync } from 'child_process';
import { nanoid } from 'nanoid';
import { getDb } from './db';
import { emitEvent } from './events';

export interface WorktreeRecord {
    id: string;
    card_id: string;
    path: string;
    branch: string;
    base_branch: string;
    base_sha: string;
    repo_path: string;
    state: 'active' | 'merged' | 'abandoned' | 'missing';
    last_seen_at: number;
    created_at: number;
}

export interface WorktreeStatus {
    path: string;
    branch: string;
    base_branch: string;
    base_sha: string;
    ahead: number;
    behind: number;
    dirty_files: number;
    last_commit: { sha: string; subject: string; iso: string } | null;
    exists: boolean;
}

function git(repoOrWorktree: string, args: string[]): string {
    return execFileSync('git', ['-C', repoOrWorktree, ...args], { encoding: 'utf8' }).trim();
}

function gitSafe(repoOrWorktree: string, args: string[]): string | null {
    try { return git(repoOrWorktree, args); } catch { return null; }
}

function gitCommonDir(repoPath: string): string {
    const raw = git(repoPath, ['rev-parse', '--git-common-dir']);
    return path.isAbsolute(raw) ? raw : path.resolve(repoPath, raw);
}

function truncateSlug(slug: string, max = 30): string {
    return slug.slice(0, max).replace(/-+$/, '') || 'card';
}

function buildBranchName(repoPath: string, slug: string, cardId: string): string {
    const short = cardId.slice(-6);
    let candidate = `concerto/${truncateSlug(slug)}-${short}`;
    let n = 2;
    while (gitSafe(repoPath, ['show-ref', '--verify', '--quiet', `refs/heads/${candidate}`]) !== null) {
        candidate = `concerto/${truncateSlug(slug)}-${short}-${n}`;
        n++;
        if (n > 99) throw new Error('could not allocate unique branch name');
    }
    return candidate;
}

export function getWorktreeByCard(cardId: string): WorktreeRecord | null {
    const row = getDb().prepare('SELECT * FROM worktrees WHERE card_id = ?').get(cardId) as WorktreeRecord | undefined;
    return row || null;
}

export interface CreateWorktreeInput {
    cardId: string;
    slug: string;
    repoPath: string;
    baseBranch: string;
}

export function createWorktree(input: CreateWorktreeInput): WorktreeRecord {
    const existing = getWorktreeByCard(input.cardId);
    if (existing && existing.state === 'active') return existing;

    const baseSha = git(input.repoPath, ['rev-parse', input.baseBranch]);
    const commonDir = gitCommonDir(input.repoPath);
    const worktreePath = path.join(commonDir, 'concerto-worktrees', input.cardId);
    const branch = buildBranchName(input.repoPath, input.slug, input.cardId);

    fs.mkdirSync(path.dirname(worktreePath), { recursive: true });

    git(input.repoPath, ['worktree', 'add', '-b', branch, worktreePath, input.baseBranch]);

    const now = Date.now();
    const id = nanoid(10);
    const record: WorktreeRecord = {
        id,
        card_id: input.cardId,
        path: worktreePath,
        branch,
        base_branch: input.baseBranch,
        base_sha: baseSha,
        repo_path: input.repoPath,
        state: 'active',
        last_seen_at: now,
        created_at: now,
    };

    getDb().prepare(`
        INSERT INTO worktrees (id, card_id, path, branch, base_branch, base_sha, repo_path, state, last_seen_at, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(card_id) DO UPDATE SET
            path=excluded.path,
            branch=excluded.branch,
            base_branch=excluded.base_branch,
            base_sha=excluded.base_sha,
            repo_path=excluded.repo_path,
            state=excluded.state,
            last_seen_at=excluded.last_seen_at
    `).run(id, input.cardId, worktreePath, branch, input.baseBranch, baseSha, input.repoPath, 'active', now, now);

    emitEvent('worktree:created', { card_id: input.cardId, path: worktreePath, branch });
    return record;
}

export interface RemoveWorktreeOpts {
    stashDirty?: boolean;
    state?: 'merged' | 'abandoned';
}

export function removeWorktree(cardId: string, opts: RemoveWorktreeOpts = {}): { stashedRef?: string; hadDirtyFiles: boolean } {
    const wt = getWorktreeByCard(cardId);
    if (!wt) return { hadDirtyFiles: false };

    const targetState = opts.state || 'abandoned';
    const dirty = countDirtyFiles(wt.path);
    let stashedRef: string | undefined;

    if (dirty > 0) {
        if (!opts.stashDirty && targetState === 'abandoned') {
            throw Object.assign(new Error('worktree has uncommitted changes'), {
                code: 'dirty_worktree',
                dirty_files: dirty,
                hint: 'pass stashDirty=true to stash work to refs/concerto-abandoned/<cardId>',
            });
        }
        if (opts.stashDirty) {
            try {
                git(wt.path, ['add', '-A']);
                const stashSha = gitSafe(wt.path, ['stash', 'create']);
                if (stashSha) {
                    const ref = `refs/concerto-abandoned/${cardId}`;
                    git(wt.repo_path, ['update-ref', ref, stashSha]);
                    stashedRef = ref;
                }
            } catch {
                // best-effort; proceed with removal
            }
        }
    }

    try {
        git(wt.repo_path, ['worktree', 'remove', '--force', wt.path]);
    } catch {
        // worktree may already be gone
        try { fs.rmSync(wt.path, { recursive: true, force: true }); } catch {}
    }

    try {
        git(wt.repo_path, ['branch', '-D', wt.branch]);
    } catch {
        // branch may already be gone (e.g. after merge cleanup)
    }

    getDb().prepare('UPDATE worktrees SET state = ?, last_seen_at = ? WHERE card_id = ?')
        .run(targetState, Date.now(), cardId);

    emitEvent('worktree:removed', { card_id: cardId, state: targetState, stashed_ref: stashedRef });
    return { stashedRef, hadDirtyFiles: dirty > 0 };
}

function countDirtyFiles(worktreePath: string): number {
    if (!fs.existsSync(worktreePath)) return 0;
    const out = gitSafe(worktreePath, ['status', '--porcelain']);
    if (!out) return 0;
    return out.split('\n').filter((l) => l.trim().length > 0).length;
}

export function worktreeStatus(cardId: string): WorktreeStatus | null {
    const wt = getWorktreeByCard(cardId);
    if (!wt) return null;
    const exists = fs.existsSync(wt.path);
    if (!exists) {
        return {
            path: wt.path,
            branch: wt.branch,
            base_branch: wt.base_branch,
            base_sha: wt.base_sha,
            ahead: 0,
            behind: 0,
            dirty_files: 0,
            last_commit: null,
            exists: false,
        };
    }
    const dirty = countDirtyFiles(wt.path);
    let ahead = 0, behind = 0;
    const counts = gitSafe(wt.path, ['rev-list', '--left-right', '--count', `${wt.base_branch}...HEAD`]);
    if (counts) {
        const [b, a] = counts.split('\t').map((n) => parseInt(n, 10));
        behind = b || 0;
        ahead = a || 0;
    }
    const log = gitSafe(wt.path, ['log', '-1', '--pretty=format:%H|%s|%aI']);
    let last_commit: WorktreeStatus['last_commit'] = null;
    if (log) {
        const [sha, subject, iso] = log.split('|');
        if (sha) last_commit = { sha, subject: subject || '', iso: iso || '' };
    }
    return {
        path: wt.path,
        branch: wt.branch,
        base_branch: wt.base_branch,
        base_sha: wt.base_sha,
        ahead,
        behind,
        dirty_files: dirty,
        last_commit,
        exists: true,
    };
}

const DIFF_BYTE_CAP = 1_000_000;

export function worktreeDiff(cardId: string, against: 'base' | 'head' = 'base'): string {
    const wt = getWorktreeByCard(cardId);
    if (!wt) return '';
    if (!fs.existsSync(wt.path)) return '';
    const args = against === 'head'
        ? ['diff', 'HEAD']
        : ['diff', `${wt.base_branch}...HEAD`];
    try {
        const out = execFileSync('git', ['-C', wt.path, ...args], {
            encoding: 'utf8',
            maxBuffer: DIFF_BYTE_CAP * 2,
        });
        return out.length > DIFF_BYTE_CAP ? out.slice(0, DIFF_BYTE_CAP) + '\n\n[…diff truncated]\n' : out;
    } catch {
        return '';
    }
}

export function reconcile(): { missing: string[]; reactivated: string[] } {
    const db = getDb();
    const active = db.prepare("SELECT * FROM worktrees WHERE state = 'active'").all() as WorktreeRecord[];
    const missing: string[] = [];
    const reactivated: string[] = [];
    for (const wt of active) {
        if (!fs.existsSync(wt.path)) {
            db.prepare("UPDATE worktrees SET state = 'missing', last_seen_at = ? WHERE id = ?")
                .run(Date.now(), wt.id);
            missing.push(wt.card_id);
            continue;
        }
        db.prepare('UPDATE worktrees SET last_seen_at = ? WHERE id = ?')
            .run(Date.now(), wt.id);
    }
    // also resurrect any 'missing' rows whose paths are back
    const missingRows = db.prepare("SELECT * FROM worktrees WHERE state = 'missing'").all() as WorktreeRecord[];
    for (const wt of missingRows) {
        if (fs.existsSync(wt.path)) {
            db.prepare("UPDATE worktrees SET state = 'active', last_seen_at = ? WHERE id = ?")
                .run(Date.now(), wt.id);
            reactivated.push(wt.card_id);
        }
    }
    return { missing, reactivated };
}
