import { Hono } from 'hono';
import { cards, projects, controller, worktrees, createCardEvent } from '@concerto/core';
import { httpError, errorStatus, parseJsonBody } from './_helpers';
import {
    createCardBody,
    updateCardBody,
    transitionBody,
    noteBody,
    mergeBody,
    abandonBody,
} from './schemas';

const router = new Hono();

router.get('/projects/:id/cards', (c) => {
    const project = projects.getProject(c.req.param('id'));
    if (!project) return httpError(c, 404, 'not_found', 'project not found');
    const stageId = c.req.query('stage') || undefined;
    return c.json(cards.listCards(project.id, stageId));
});

router.get('/projects/:id/board', (c) => {
    const project = projects.getProject(c.req.param('id'));
    if (!project) return httpError(c, 404, 'not_found', 'project not found');
    return c.json({
        cards: cards.listCards(project.id),
        worktree_meta: worktrees.getBoardMeta(project.id),
    });
});

router.post('/projects/:id/cards', async (c) => {
    const project = projects.getProject(c.req.param('id'));
    if (!project) return httpError(c, 404, 'not_found', 'project not found');
    const parsed = await parseJsonBody(c, createCardBody);
    if (!parsed.ok) return httpError(c, 400, 'bad_request', parsed.message);
    const body = parsed.data;
    try {
        const card = cards.createCard({
            project_id: project.id,
            title: body.title,
            description: body.description,
            stage_id: body.stage_id,
            model_override: body.model_override,
        });
        return c.json(card, 201);
    } catch (err: any) {
        return httpError(c, 400, 'bad_request', err.message);
    }
});

router.get('/cards/:id', (c) => {
    const card = cards.getCard(c.req.param('id'));
    if (!card) return httpError(c, 404, 'not_found', 'card not found');
    return c.json(card);
});

router.patch('/cards/:id', async (c) => {
    const parsed = await parseJsonBody(c, updateCardBody);
    if (!parsed.ok) return httpError(c, 400, 'bad_request', parsed.message);
    const card = cards.updateCard(c.req.param('id'), parsed.data);
    if (!card) return httpError(c, 404, 'not_found', 'card not found');
    return c.json(card);
});

router.delete('/cards/:id', (c) => {
    const id = c.req.param('id');
    const check = cards.canDelete(id);
    if (!check.ok) {
        if (check.allowed.length === 0 && check.reason === 'card not found') {
            return httpError(c, 404, 'not_found', 'card not found');
        }
        return httpError(c, 409, 'invalid_state', check.reason, {
            hint: 'move the card to a backlog stage first, or use POST /cards/:id/abandon',
            allowed: check.allowed,
        });
    }
    cards.deleteCard(id);
    return c.json({ ok: true });
});

router.post('/cards/:id/transitions', async (c) => {
    const parsed = await parseJsonBody(c, transitionBody);
    if (!parsed.ok) return httpError(c, 400, 'bad_request', parsed.message);
    const body = parsed.data;
    const actor = controller.parseActor(body.actor, 'user');
    const result = controller.transition({
        cardId: c.req.param('id'),
        toStageId: body.to_stage_id,
        actor,
        reason: body.reason,
    });
    if (!result.ok) {
        return httpError(c, errorStatus(result.code) as 400 | 404 | 409, result.code, result.message, {
            hint: result.hint,
            allowed: result.allowed,
        });
    }
    return c.json(result.card);
});

router.get('/cards/:id/worktree', (c) => {
    const status = worktrees.worktreeStatus(c.req.param('id'));
    if (!status) return httpError(c, 404, 'not_found', 'no worktree for this card');
    return c.json(status);
});

router.get('/cards/:id/diff', (c) => {
    const against = c.req.query('against') === 'head' ? 'head' : 'base';
    const diff = worktrees.worktreeDiff(c.req.param('id'), against);
    return c.text(diff, 200, { 'Content-Type': 'text/plain; charset=utf-8' });
});

router.post('/cards/:id/notes', async (c) => {
    const parsed = await parseJsonBody(c, noteBody);
    if (!parsed.ok) return httpError(c, 400, 'bad_request', parsed.message);
    const body = parsed.data;
    const card = cards.getCard(c.req.param('id'));
    if (!card) return httpError(c, 404, 'not_found', 'card not found');
    const actor = controller.parseActor(body.actor, 'agent');
    const at = createCardEvent({
        cardId: card.id,
        projectId: card.project_id,
        kind: 'note',
        actor,
        payload: { content: body.content },
        emitPayload: { content: body.content },
    });
    return c.json({ ok: true, at });
});

router.post('/cards/:id/merge', async (c) => {
    const parsed = await parseJsonBody(c, mergeBody, { allowEmpty: true });
    if (!parsed.ok) return httpError(c, 400, 'bad_request', parsed.message);
    const body = parsed.data;
    const result = controller.merge({
        cardId: c.req.param('id'),
        strategy: body.strategy,
        commitMessage: body.commit_message,
        actor: body.actor,
    });
    if (!result.ok) {
        return httpError(c, errorStatus(result.code) as 400 | 404 | 409, result.code, result.message, {
            hint: result.hint,
            conflicts: result.conflicts,
            allowed: result.allowed,
        });
    }
    return c.json({ card: result.card, merge: result.merge });
});

router.post('/cards/:id/abandon', async (c) => {
    const parsed = await parseJsonBody(c, abandonBody, { allowEmpty: true });
    if (!parsed.ok) return httpError(c, 400, 'bad_request', parsed.message);
    const body = parsed.data;
    try {
        const result = controller.abandon(c.req.param('id'), {
            stashDirty: body.stash_dirty !== false,
            actor: body.actor,
        });
        if (!result) return httpError(c, 404, 'not_found', 'card not found');
        return c.json(result);
    } catch (err: any) {
        const code = err.code || 'abandon_failed';
        return httpError(c, errorStatus(code) as 400 | 404 | 409, code, err.message, {
            hint: err.hint,
            dirty_files: err.dirty_files,
        });
    }
});

export default router;
