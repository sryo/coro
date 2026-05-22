import path from 'path';
import fs from 'fs';
import { execFileSync } from 'child_process';
import { nanoid } from 'nanoid';
import type { WorktreeRecord, WorktreeStatus, WorktreeBoardMeta } from '@coro/types';
import { getDb } from './db';
import { DIFF_BYTE_CAP } from './config';
import { emitEvent } from './events';

export type { WorktreeRecord, WorktreeStatus, WorktreeBoardMeta } from '@coro/types';

// Optional hook fired after a worktree is created. Daemon uses this to drop a
// .mcp.json into the worktree without core having to know what MCP is.
export type WorktreeCreatedHook = (input: { worktreePath: string; cardId: string }) => void;
let createHook: WorktreeCreatedHook | null = null;
export function onWorktreeCreated(h: WorktreeCreatedHook | null): void { createHook = h; }

function git(repoOrWorktree: string, args: string[]): string {
    return execFileSync('git', ['-C', repoOrWorktree, ...args], { encoding: 'utf8' }).trim();
}

function gitSafe(repoOrWorktree: string, args: string[]): string | null {
    try { return git(repoOrWorktree, args); } catch { return null; }
}

function gitWithOutput(
    repoOrWorktree: string,
    args: string[],
): { stdout: string; stderr: string; status: number } {
    try {
        const stdout = execFileSync('git', ['-C', repoOrWorktree, ...args], { encoding: 'utf8' });
        return { stdout, stderr: '', status: 0 };
    } catch (err: any) {
        return {
            stdout: err.stdout?.toString() || '',
            stderr: err.stderr?.toString() || '',
            status: typeof err.status === 'number' ? err.status : 1,
        };
    }
}

function gitCommonDir(repoPath: string): string {
    const raw = git(repoPath, ['rev-parse', '--git-common-dir']);
    return path.isAbsolute(raw) ? raw : path.resolve(repoPath, raw);
}

function worktreeGitDir(worktreePath: string): string {
    const raw = git(worktreePath, ['rev-parse', '--git-dir']);
    return path.isAbsolute(raw) ? raw : path.resolve(worktreePath, raw);
}

// Per-worktree hooks require extensions.worktreeConfig=true on the main repo
// so `git config --worktree core.hooksPath ...` is honored. Safe, idempotent:
// the extension is a namespace enabler, not a behavior change.
function ensureWorktreeConfigExtension(repoPath: string): void {
    const current = gitSafe(repoPath, ['config', '--get', 'extensions.worktreeConfig']);
    if (current === 'true') return;
    git(repoPath, ['config', 'extensions.worktreeConfig', 'true']);
}

// Refuse `git push` from agent worktrees, and stamp every commit with a
// Coro-Card-Id trailer so `git log --grep` finds it forever. Hooks live in
// the per-worktree git-dir (cleaned up automatically by `git worktree remove`).
function installAgentHooks(repoPath: string, worktreePath: string, cardId: string): void {
    try {
        ensureWorktreeConfigExtension(repoPath);
        const hooksDir = path.join(worktreeGitDir(worktreePath), 'hooks');
        fs.mkdirSync(hooksDir, { recursive: true });

        const prePush = `#!/bin/sh\n`
            + `echo "coro: agent worktree for card ${cardId} cannot push; commit locally and merge from the dashboard." >&2\n`
            + `exit 1\n`;
        fs.writeFileSync(path.join(hooksDir, 'pre-push'), prePush, { mode: 0o755 });

        const commitMsg = `#!/bin/sh\n`
            + `exec git interpret-trailers --if-exists addIfDifferent \\\n`
            + `    --trailer "Coro-Card-Id: ${cardId}" --in-place "$1"\n`;
        fs.writeFileSync(path.join(hooksDir, 'commit-msg'), commitMsg, { mode: 0o755 });

        git(worktreePath, ['config', '--worktree', 'core.hooksPath', hooksDir]);
    } catch {
        // Hooks are a safety net, not load-bearing — never fail worktree creation
        // because we couldn't install them. The user's `--dangerously-skip-permissions`
        // stance is unchanged.
    }
}

function truncateSlug(slug: string, max = 30): string {
    return slug.slice(0, max).replace(/-+$/, '') || 'card';
}

function buildBranchName(repoPath: string, slug: string, cardId: string): string {
    const short = cardId.slice(-6);
    let candidate = `coro/${truncateSlug(slug)}-${short}`;
    let n = 2;
    while (gitSafe(repoPath, ['show-ref', '--verify', '--quiet', `refs/heads/${candidate}`]) !== null) {
        candidate = `coro/${truncateSlug(slug)}-${short}-${n}`;
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
    const worktreePath = path.join(commonDir, 'coro-worktrees', input.cardId);
    const branch = buildBranchName(input.repoPath, input.slug, input.cardId);

    fs.mkdirSync(path.dirname(worktreePath), { recursive: true });

    git(input.repoPath, ['worktree', 'add', '-b', branch, worktreePath, input.baseBranch]);
    installAgentHooks(input.repoPath, worktreePath, input.cardId);

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
        dirty_files: 0,
        behind: 0,
        merge_conflict_at: null,
    };

    try { createHook?.({ worktreePath, cardId: input.cardId }); } catch {}

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
                hint: 'pass stashDirty=true to stash work to refs/coro-abandoned/<cardId>',
            });
        }
        if (opts.stashDirty) {
            try {
                git(wt.path, ['add', '-A']);
                const stashSha = gitSafe(wt.path, ['stash', 'create']);
                if (stashSha) {
                    const ref = `refs/coro-abandoned/${cardId}`;
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

export type MergeStrategy = 'squash' | 'merge';

export interface MergePrecheck {
    conflicts: string[];
    baseSha: string;
    branchSha: string;
    alreadyMerged: boolean;
}

export function precheckMerge(repoPath: string, baseBranch: string, branch: string): MergePrecheck {
    const baseSha = git(repoPath, ['rev-parse', baseBranch]);
    const branchSha = git(repoPath, ['rev-parse', branch]);
    const ancestry = gitWithOutput(repoPath, ['merge-base', '--is-ancestor', branch, baseBranch]);
    const alreadyMerged = ancestry.status === 0;
    if (alreadyMerged) return { conflicts: [], baseSha, branchSha, alreadyMerged };

    const res = gitWithOutput(repoPath, [
        'merge-tree', '--write-tree', '--name-only', '--no-messages', baseBranch, branch,
    ]);
    if (res.status === 0) return { conflicts: [], baseSha, branchSha, alreadyMerged: false };
    const lines = res.stdout.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
    // First line of merge-tree output is the tree OID; remaining lines are conflicted paths.
    const conflicts = lines.slice(1);
    return { conflicts, baseSha, branchSha, alreadyMerged: false };
}

export interface PerformMergeResult {
    mergeSha: string;
    treeSha: string;
    alreadyMerged: boolean;
}

export function performMerge(
    repoPath: string,
    baseBranch: string,
    branch: string,
    strategy: MergeStrategy,
    commitMessage: string,
    precheck?: MergePrecheck,
): PerformMergeResult {
    const baseSha = precheck?.baseSha ?? git(repoPath, ['rev-parse', baseBranch]);
    const branchSha = precheck?.branchSha ?? git(repoPath, ['rev-parse', branch]);
    const alreadyMerged = precheck
        ? precheck.alreadyMerged
        : gitWithOutput(repoPath, ['merge-base', '--is-ancestor', branch, baseBranch]).status === 0;

    if (alreadyMerged) {
        return { mergeSha: baseSha, treeSha: git(repoPath, ['rev-parse', `${baseBranch}^{tree}`]), alreadyMerged: true };
    }

    const treeRes = gitWithOutput(repoPath, [
        'merge-tree', '--write-tree', '--no-messages', baseBranch, branch,
    ]);
    if (treeRes.status !== 0) {
        throw Object.assign(new Error('merge-tree reported conflicts'), {
            code: 'conflict',
            stdout: treeRes.stdout,
        });
    }
    const treeSha = treeRes.stdout.split('\n')[0]?.trim();
    if (!treeSha) throw new Error('merge-tree produced no tree OID');

    const parentArgs = strategy === 'squash'
        ? ['-p', baseSha]
        : ['-p', baseSha, '-p', branchSha];
    const mergeSha = git(repoPath, ['commit-tree', treeSha, ...parentArgs, '-m', commitMessage]);

    // Compare-and-swap on baseSha — if base moved since precheck, this fails and the merge aborts.
    git(repoPath, ['update-ref', `refs/heads/${baseBranch}`, mergeSha, baseSha]);

    return { mergeSha, treeSha, alreadyMerged: false };
}

export function pruneAbandonedStashes(maxAgeMs: number): { deleted: { repo: string; ref: string }[] } {
    const db = getDb();
    const repos = db.prepare('SELECT DISTINCT repo_path FROM worktrees').all() as { repo_path: string }[];
    const deleted: { repo: string; ref: string }[] = [];
    const cutoffSec = Math.floor((Date.now() - maxAgeMs) / 1000);

    for (const { repo_path } of repos) {
        const listing = gitWithOutput(repo_path, [
            'for-each-ref',
            '--format=%(refname) %(committerdate:unix)',
            'refs/coro-abandoned/',
        ]);
        if (listing.status !== 0) continue;
        for (const line of listing.stdout.split('\n')) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            const [ref, tsStr] = trimmed.split(/\s+/);
            const ts = parseInt(tsStr, 10);
            if (!ref || !Number.isFinite(ts)) continue;
            if (ts >= cutoffSec) continue;
            const res = gitWithOutput(repo_path, ['update-ref', '-d', ref]);
            if (res.status === 0) deleted.push({ repo: repo_path, ref });
        }
    }
    return { deleted };
}

/** Rename a card's branch via `git branch -m` inside the worktree. Updates the
 * worktrees row and cards.branch_name. Refuses if the new name collides with an
 * existing local branch. The card's project_id is needed for the SSE event;
 * read it from the cards row to avoid threading it through callers. */
export function renameCardBranch(cardId: string, newName: string): { ok: true } | { ok: false; reason: string } {
    const wt = getWorktreeByCard(cardId);
    if (!wt) return { ok: false, reason: 'card has no worktree' };
    const trimmed = newName.trim();
    if (!trimmed) return { ok: false, reason: 'branch name required' };
    if (trimmed === wt.branch) return { ok: true };
    if (!/^[\w./-]+$/.test(trimmed) || trimmed.startsWith('-') || trimmed.endsWith('.')) {
        return { ok: false, reason: 'invalid branch name' };
    }
    if (gitSafe(wt.repo_path, ['show-ref', '--verify', '--quiet', `refs/heads/${trimmed}`]) !== null) {
        return { ok: false, reason: `branch '${trimmed}' already exists` };
    }
    const result = gitWithOutput(wt.path, ['branch', '-m', trimmed]);
    if (result.status !== 0) {
        return { ok: false, reason: result.stderr.trim() || 'rename failed' };
    }
    const db = getDb();
    db.prepare('UPDATE worktrees SET branch = ? WHERE id = ?').run(trimmed, wt.id);
    db.prepare('UPDATE cards SET branch_name = ?, updated_at = ? WHERE id = ?').run(trimmed, Date.now(), cardId);
    const card = db.prepare('SELECT project_id FROM cards WHERE id = ?').get(cardId) as { project_id: string } | undefined;
    emitEvent('card:worktree_changed', { card_id: cardId, project_id: card?.project_id, branch: trimmed });
    return { ok: true };
}

export function refreshWorktreeMetrics(cardId: string): void {
    const wt = getWorktreeByCard(cardId);
    if (!wt || wt.state !== 'active') return;
    if (!fs.existsSync(wt.path)) return;
    const dirty = countDirtyFiles(wt.path);
    let behind = 0;
    const counts = gitSafe(wt.path, ['rev-list', '--left-right', '--count', `${wt.base_branch}...HEAD`]);
    if (counts) {
        const [b] = counts.split('\t').map((n) => parseInt(n, 10));
        behind = b || 0;
    }
    if (dirty === wt.dirty_files && behind === wt.behind) return;
    getDb().prepare('UPDATE worktrees SET dirty_files = ?, behind = ? WHERE id = ?')
        .run(dirty, behind, wt.id);
}

export function setMergeConflict(cardId: string, at: number | null): void {
    getDb().prepare('UPDATE worktrees SET merge_conflict_at = ? WHERE card_id = ?').run(at, cardId);
}

export function getBoardMeta(projectId: string): Record<string, WorktreeBoardMeta> {
    const rows = getDb().prepare(`
        SELECT card_id, state, dirty_files, behind, merge_conflict_at FROM worktrees WHERE card_id IN (
            SELECT id FROM cards WHERE project_id = ?
        )
    `).all(projectId) as ({ card_id: string } & WorktreeBoardMeta)[];
    const out: Record<string, WorktreeBoardMeta> = {};
    for (const r of rows) {
        out[r.card_id] = {
            state: r.state,
            dirty_files: r.dirty_files,
            behind: r.behind,
            merge_conflict_at: r.merge_conflict_at,
        };
    }
    return out;
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
        try { refreshWorktreeMetrics(wt.card_id); } catch {}
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
