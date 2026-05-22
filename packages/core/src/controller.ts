import type { Actor, StageKind } from '@coro/types';
import { getDb } from './db';
import { getCard, type Card } from './cards';
import { getStage, listStages, findByKind, type Stage } from './stages';
import { getProject } from './projects';
import {
    createWorktree, removeWorktree, getWorktreeByCard,
    precheckMerge, performMerge, setMergeConflict,
    type MergeStrategy,
} from './worktree';
import { createCardEvent } from './events';

export type { Actor } from '@coro/types';

/**
 * Parse an unknown actor field into the typed Actor union, falling back to a
 * default. Routes used to inline this; centralizing it keeps the wire shape
 * decision in one place.
 */
export function parseActor(input: unknown, fallback: Actor): Actor {
    return input === 'user' || input === 'agent' || input === 'system' ? input : fallback;
}

/**
 * Stage kinds that require going through a dedicated endpoint rather than a
 * direct transition. Today that's archive (POST /cards/:id/merge); extend the
 * set here when new gated kinds appear.
 */
const ENDPOINT_KINDS: ReadonlySet<StageKind> = new Set(['archive']);

export function requiresMergeEndpoint(toKind: StageKind): boolean {
    return ENDPOINT_KINDS.has(toKind);
}

export interface TransitionInput {
    cardId: string;
    toStageId: string;
    actor: Actor;
    reason?: string;
}

export type TransitionResult =
    | { ok: true; card: Card }
    | { ok: false; code: TransitionError; message: string; hint?: string; allowed: string[] };

export type TransitionError =
    | 'card_not_found'
    | 'stage_not_found'
    | 'cross_project'
    | 'archive_immutable'
    | 'archive_via_merge'
    | 'done_requires_review_user'
    | 'worktree_failed';

/** Stages the caller can move a card to right now, given the current state and actor. */
export function allowedTransitions(card: Card, actor: Actor): Stage[] {
    const from = getStage(card.stage_id);
    if (!from) return [];
    if (from.kind === 'archive') return []; // immutable
    const all = listStages(card.project_id);
    return all.filter((s) => {
        if (s.id === from.id) return false;
        if (requiresMergeEndpoint(s.kind)) return false;
        if (s.kind === 'done' && (from.kind !== 'review' || actor !== 'user')) return false;
        return true;
    });
}

/** Stage IDs the caller can move to right now, given the current state and actor. */
export function transitionTargets(cardId: string, actor: Actor): string[] {
    const card = getCard(cardId);
    if (!card) return [];
    return allowedTransitions(card, actor).map((s) => s.id);
}

export function transition(input: TransitionInput): TransitionResult {
    const card = getCard(input.cardId);
    if (!card) return { ok: false, code: 'card_not_found', message: 'card not found', allowed: [] };

    const from = getStage(card.stage_id);
    if (!from) return { ok: false, code: 'stage_not_found', message: 'current stage missing', allowed: [] };

    const to = getStage(input.toStageId);
    if (!to) {
        return {
            ok: false,
            code: 'stage_not_found',
            message: 'target stage not found',
            allowed: transitionTargets(input.cardId, input.actor),
        };
    }

    if (to.project_id !== card.project_id) {
        return { ok: false, code: 'cross_project', message: 'cannot transition across projects', allowed: [] };
    }

    if (from.id === to.id) return { ok: true, card };

    const allowed = () => transitionTargets(input.cardId, input.actor);

    if (from.kind === 'archive') {
        return { ok: false, code: 'archive_immutable', message: 'cards in archive stages are immutable', allowed: [] };
    }

    if (requiresMergeEndpoint(to.kind)) {
        return {
            ok: false,
            code: 'archive_via_merge',
            message: `${to.kind} stages are only reachable via POST /cards/:id/merge`,
            hint: 'use the merge endpoint instead of a direct transition',
            allowed: allowed(),
        };
    }

    if (to.kind === 'done' && (from.kind !== 'review' || input.actor !== 'user')) {
        return {
            ok: false,
            code: 'done_requires_review_user',
            message: 'done stage requires source kind=review and actor=user',
            hint: from.kind !== 'review'
                ? 'move the card to a review stage first'
                : 'only a human user can approve done; agents cannot self-promote',
            allowed: allowed(),
        };
    }

    if (to.kind === 'active' && !getWorktreeByCard(card.id)) {
        const project = getProject(card.project_id);
        if (!project) {
            return { ok: false, code: 'worktree_failed', message: 'project not found for worktree creation', allowed: [] };
        }
        try {
            const wt = createWorktree({
                cardId: card.id,
                slug: card.slug,
                repoPath: project.repo_path,
                baseBranch: project.base_branch,
            });
            getDb().prepare(`
                UPDATE cards SET branch_name = ?, worktree_path = ?, base_sha = ?, updated_at = ?
                WHERE id = ?
            `).run(wt.branch, wt.path, wt.base_sha, Date.now(), card.id);
        } catch (err: any) {
            return {
                ok: false,
                code: 'worktree_failed',
                message: `worktree creation failed: ${err.message}`,
                hint: 'check that the base branch exists and the repo is in a clean state',
                allowed: allowed(),
            };
        }
    }

    const db = getDb();
    const now = Date.now();
    const maxRow = db.prepare('SELECT COALESCE(MAX(position), -1) AS m FROM cards WHERE project_id = ? AND stage_id = ?')
        .get(card.project_id, to.id) as { m: number };
    const newPosition = maxRow.m + 1;

    const stampers: Record<string, string> = {
        active: 'started_at',
        review: 'review_at',
        done: 'done_at',
    };
    const stampField = stampers[to.kind];
    const stampSql = stampField
        ? `, ${stampField} = COALESCE(${stampField}, ?)`
        : '';
    const params: unknown[] = [to.id, newPosition, now];
    if (stampField) params.push(now);
    params.push(card.id);

    db.transaction(() => {
        db.prepare(`
            UPDATE cards SET stage_id = ?, position = ?, updated_at = ? ${stampSql}
            WHERE id = ?
        `).run(...params);
        if (to.kind === 'done') setMergeConflict(card.id, null);
        createCardEvent({
            cardId: card.id,
            projectId: card.project_id,
            kind: 'stage_change',
            actor: input.actor,
            payload: { from_stage_id: from.id, to_stage_id: to.id, from_kind: from.kind, to_kind: to.kind, reason: input.reason || null },
            event: 'card:stage_changed',
            emitPayload: { from_stage_id: from.id, to_stage_id: to.id },
            at: now,
        });
    })();

    return { ok: true, card: getCard(card.id)! };
}

export interface AbandonResult {
    card: Card;
    worktree: { had_dirty_files: boolean; stashed_ref?: string };
}

export interface MergeInput {
    cardId: string;
    strategy?: MergeStrategy;
    commitMessage?: string;
    actor?: Actor;
}

export type MergeResult =
    | { ok: true; card: Card; merge: { sha: string; strategy: MergeStrategy; already_merged: boolean } }
    | { ok: false; code: MergeError; message: string; hint?: string; conflicts?: string[]; allowed?: string[] };

export type MergeError =
    | 'card_not_found'
    | 'stage_not_found'
    | 'project_not_found'
    | 'no_worktree'
    | 'merge_requires_done'
    | 'no_archive_stage'
    | 'conflict'
    | 'merge_failed';

export type CanMergeResult =
    | { ok: true }
    | { ok: false; code: MergeError; message: string; hint?: string; allowed?: string[] };

/**
 * Preflight check for merge: card exists, is in a done-kind stage, has a
 * worktree and a project, and the project has an archive-kind stage. Pure
 * predicate — no DB writes, no git operations.
 */
export function canMerge(card: Card, actor: Actor = 'user'): CanMergeResult {
    const from = getStage(card.stage_id);
    if (!from) return { ok: false, code: 'stage_not_found', message: 'current stage missing' };

    if (from.kind !== 'done') {
        return {
            ok: false,
            code: 'merge_requires_done',
            message: `merge requires source kind=done, got ${from.kind}`,
            hint: 'approve the card from Review first, then merge from Done',
            allowed: transitionTargets(card.id, actor),
        };
    }

    const project = getProject(card.project_id);
    if (!project) return { ok: false, code: 'project_not_found', message: 'project not found' };

    const wt = getWorktreeByCard(card.id);
    if (!wt) return { ok: false, code: 'no_worktree', message: 'card has no worktree to merge' };

    const archive = findByKind(listStages(card.project_id), 'archive');
    if (!archive) {
        return {
            ok: false,
            code: 'no_archive_stage',
            message: 'project has no archive stage configured',
            hint: 'add an archive-kind stage in settings',
        };
    }

    return { ok: true };
}

export function merge(input: MergeInput): MergeResult {
    const card = getCard(input.cardId);
    if (!card) return { ok: false, code: 'card_not_found', message: 'card not found' };

    const check = canMerge(card, input.actor || 'user');
    if (!check.ok) return check;

    // canMerge has already proven these exist; non-null assertion is safe here.
    const from = getStage(card.stage_id)!;
    const project = getProject(card.project_id)!;
    const wt = getWorktreeByCard(card.id)!;
    const archive = findByKind(listStages(card.project_id), 'archive')!;

    const strategy: MergeStrategy = input.strategy === 'merge' ? 'merge' : 'squash';

    let pre;
    try {
        pre = precheckMerge(project.repo_path, project.base_branch, wt.branch);
    } catch (err: any) {
        return { ok: false, code: 'merge_failed', message: `precheck failed: ${err.message}` };
    }
    if (pre.conflicts.length > 0) {
        setMergeConflict(card.id, Date.now());
        return {
            ok: false,
            code: 'conflict',
            message: 'merge conflict detected',
            conflicts: pre.conflicts,
            hint: 'resolve conflicts manually then retry',
        };
    }

    const commitMessage = (input.commitMessage || card.title).trim() || card.title;

    let result;
    try {
        result = performMerge(project.repo_path, project.base_branch, wt.branch, strategy, commitMessage, pre);
    } catch (err: any) {
        if (err.code === 'conflict') {
            setMergeConflict(card.id, Date.now());
            return { ok: false, code: 'conflict', message: 'merge conflict detected at write-tree' };
        }
        return { ok: false, code: 'merge_failed', message: err.message };
    }

    try {
        removeWorktree(card.id, { stashDirty: false, state: 'merged' });
    } catch {
        // worktree cleanup is best-effort; merge already landed
    }

    const now = Date.now();
    const db = getDb();
    db.transaction(() => {
        db.prepare(`
            UPDATE cards
            SET stage_id = ?, position = ?, merged_at = ?, branch_name = NULL, worktree_path = NULL, updated_at = ?
            WHERE id = ?
        `).run(archive.id, 0, now, now, card.id);
        createCardEvent({
            cardId: card.id,
            projectId: card.project_id,
            kind: 'merge',
            actor: input.actor || 'user',
            payload: {
                strategy,
                merge_sha: result.mergeSha,
                base_branch: project.base_branch,
                already_merged: result.alreadyMerged,
                from_stage_id: from.id,
                to_stage_id: archive.id,
            },
            event: 'card:merged',
            emitPayload: {
                merge_sha: result.mergeSha,
                strategy,
                already_merged: result.alreadyMerged,
            },
            at: now,
        });
    })();

    return {
        ok: true,
        card: getCard(card.id)!,
        merge: { sha: result.mergeSha, strategy, already_merged: result.alreadyMerged },
    };
}

export type CanAbandonResult =
    | { ok: true }
    | { ok: false; code: 'card_not_found' | 'stage_not_found' | 'archive_immutable'; message: string };

/**
 * Preflight check for abandon: card exists and isn't already in an archive
 * stage (already merged). Pure predicate — does not touch the worktree.
 */
export function canAbandon(card: Card): CanAbandonResult {
    const stage = getStage(card.stage_id);
    if (!stage) return { ok: false, code: 'stage_not_found', message: 'current stage missing' };
    if (stage.kind === 'archive') {
        return { ok: false, code: 'archive_immutable', message: 'cards in archive stages are immutable' };
    }
    return { ok: true };
}

export function abandon(cardId: string, opts: { stashDirty?: boolean; actor?: Actor } = {}): AbandonResult | null {
    const card = getCard(cardId);
    if (!card) return null;
    const check = canAbandon(card);
    if (!check.ok) {
        throw Object.assign(new Error(check.message), { code: check.code });
    }
    const wt = getWorktreeByCard(cardId);

    const result = wt
        ? removeWorktree(cardId, { stashDirty: opts.stashDirty ?? true, state: 'abandoned' })
        : { hadDirtyFiles: false, stashedRef: undefined };

    const now = Date.now();
    const db = getDb();
    db.transaction(() => {
        db.prepare(`
            UPDATE cards SET abandoned_at = ?, branch_name = NULL, worktree_path = NULL, updated_at = ?
            WHERE id = ?
        `).run(now, now, cardId);
        createCardEvent({
            cardId,
            projectId: card.project_id,
            kind: 'abandon',
            actor: opts.actor || 'user',
            payload: { stashed_ref: result.stashedRef || null, had_dirty_files: result.hadDirtyFiles },
            event: 'card:abandoned',
            emitPayload: { stashed_ref: result.stashedRef },
            at: now,
        });
    })();

    return {
        card: getCard(cardId)!,
        worktree: { had_dirty_files: result.hadDirtyFiles, stashed_ref: result.stashedRef },
    };
}
