import { getDb } from './db';
import { getCard, type Card } from './cards';
import { getStage, listStages, type Stage } from './stages';
import { getProject } from './projects';
import { createWorktree, removeWorktree, getWorktreeByCard } from './worktree';
import { emitEvent } from './events';

export type Actor = 'user' | 'agent' | 'system';

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

/** Stage IDs the caller can move to right now, given the current state and actor. */
export function transitionTargets(cardId: string, actor: Actor): string[] {
    const card = getCard(cardId);
    if (!card) return [];
    const from = getStage(card.stage_id);
    if (!from) return [];
    const all = listStages(card.project_id);
    return all.filter((s) => {
        if (s.id === from.id) return false;
        if (from.kind === 'archive') return false; // immutable
        if (s.kind === 'archive') return false; // merge endpoint only
        if (s.kind === 'done' && (from.kind !== 'review' || actor !== 'user')) return false;
        return true;
    }).map((s) => s.id);
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

    if (to.kind === 'archive') {
        return {
            ok: false,
            code: 'archive_via_merge',
            message: 'archive stages are only reachable via POST /cards/:id/merge',
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

    db.prepare(`
        UPDATE cards SET stage_id = ?, position = ?, updated_at = ? ${stampSql}
        WHERE id = ?
    `).run(...params);

    db.prepare(`
        INSERT INTO events (card_id, project_id, kind, actor, payload_json, created_at)
        VALUES (?, ?, 'stage_change', ?, ?, ?)
    `).run(
        card.id,
        card.project_id,
        input.actor,
        JSON.stringify({ from_stage_id: from.id, to_stage_id: to.id, from_kind: from.kind, to_kind: to.kind, reason: input.reason || null }),
        now,
    );

    emitEvent('card:stage_changed', {
        card_id: card.id,
        project_id: card.project_id,
        from_stage_id: from.id,
        to_stage_id: to.id,
        actor: input.actor,
    });

    return { ok: true, card: getCard(card.id)! };
}

export interface AbandonResult {
    card: Card;
    worktree: { had_dirty_files: boolean; stashed_ref?: string };
}

export function abandon(cardId: string, opts: { stashDirty?: boolean; actor?: Actor } = {}): AbandonResult | null {
    const card = getCard(cardId);
    if (!card) return null;
    const wt = getWorktreeByCard(cardId);

    const result = wt
        ? removeWorktree(cardId, { stashDirty: opts.stashDirty ?? true, state: 'abandoned' })
        : { hadDirtyFiles: false, stashedRef: undefined };

    const now = Date.now();
    getDb().prepare(`
        UPDATE cards SET abandoned_at = ?, branch_name = NULL, worktree_path = NULL, updated_at = ?
        WHERE id = ?
    `).run(now, now, cardId);

    getDb().prepare(`
        INSERT INTO events (card_id, project_id, kind, actor, payload_json, created_at)
        VALUES (?, ?, 'abandon', ?, ?, ?)
    `).run(
        cardId,
        card.project_id,
        opts.actor || 'user',
        JSON.stringify({ stashed_ref: result.stashedRef || null, had_dirty_files: result.hadDirtyFiles }),
        now,
    );

    emitEvent('card:abandoned', { card_id: cardId, project_id: card.project_id, stashed_ref: result.stashedRef });

    return {
        card: getCard(cardId)!,
        worktree: { had_dirty_files: result.hadDirtyFiles, stashed_ref: result.stashedRef },
    };
}
