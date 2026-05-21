import { Hono } from 'hono';
import { cards, projects, stages, controller, worktrees } from '@concerto/core';

const router = new Hono();

router.get('/projects/:id/cards', (c) => {
    const project = projects.getProject(c.req.param('id'));
    if (!project) return c.json({ error: { code: 'not_found', message: 'project not found' } }, 404);
    const stageId = c.req.query('stage') || undefined;
    return c.json(cards.listCards(project.id, stageId));
});

router.post('/projects/:id/cards', async (c) => {
    const project = projects.getProject(c.req.param('id'));
    if (!project) return c.json({ error: { code: 'not_found', message: 'project not found' } }, 404);
    const body = await c.req.json().catch(() => null) as { title?: string; description?: string; stage_id?: string; model_override?: string } | null;
    if (!body?.title || body.title.length === 0) {
        return c.json({ error: { code: 'bad_request', message: 'title required' } }, 400);
    }
    if (body.title.length > 200) {
        return c.json({ error: { code: 'bad_request', message: 'title must be ≤ 200 chars' } }, 400);
    }
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
        return c.json({ error: { code: 'bad_request', message: err.message } }, 400);
    }
});

router.get('/cards/:id', (c) => {
    const card = cards.getCard(c.req.param('id'));
    if (!card) return c.json({ error: { code: 'not_found', message: 'card not found' } }, 404);
    return c.json(card);
});

router.patch('/cards/:id', async (c) => {
    const body = await c.req.json().catch(() => null) as Record<string, unknown> | null;
    if (!body) return c.json({ error: { code: 'bad_request', message: 'json body required' } }, 400);
    const card = cards.updateCard(c.req.param('id'), body as any);
    if (!card) return c.json({ error: { code: 'not_found', message: 'card not found' } }, 404);
    return c.json(card);
});

router.delete('/cards/:id', (c) => {
    const id = c.req.param('id');
    const card = cards.getCard(id);
    if (!card) return c.json({ error: { code: 'not_found', message: 'card not found' } }, 404);
    try {
        cards.deleteCard(id);
        return c.json({ ok: true });
    } catch (err: any) {
        const allowed = stages.listStages(card.project_id).filter(s => s.kind === 'backlog').map(s => s.id);
        return c.json({
            error: {
                code: 'invalid_state',
                message: err.message,
                hint: 'move the card to a backlog stage first, or use POST /cards/:id/abandon',
                allowed,
            },
        }, 409);
    }
});

router.post('/cards/:id/transitions', async (c) => {
    const body = await c.req.json().catch(() => null) as { to_stage_id?: string; actor?: controller.Actor; reason?: string } | null;
    if (!body?.to_stage_id) {
        return c.json({ error: { code: 'bad_request', message: 'to_stage_id required' } }, 400);
    }
    const actor: controller.Actor = body.actor === 'agent' ? 'agent' : body.actor === 'system' ? 'system' : 'user';
    const result = controller.transition({
        cardId: c.req.param('id'),
        toStageId: body.to_stage_id,
        actor,
        reason: body.reason,
    });
    if (!result.ok) {
        const status = result.code === 'card_not_found' || result.code === 'stage_not_found' ? 404 : 409;
        return c.json({
            error: {
                code: result.code,
                message: result.message,
                hint: result.hint,
                allowed: result.allowed,
            },
        }, status);
    }
    return c.json(result.card);
});

router.get('/cards/:id/worktree', (c) => {
    const status = worktrees.worktreeStatus(c.req.param('id'));
    if (!status) return c.json({ error: { code: 'not_found', message: 'no worktree for this card' } }, 404);
    return c.json(status);
});

router.get('/cards/:id/diff', (c) => {
    const against = c.req.query('against') === 'head' ? 'head' : 'base';
    const diff = worktrees.worktreeDiff(c.req.param('id'), against);
    return c.text(diff, 200, { 'Content-Type': 'text/plain; charset=utf-8' });
});

router.post('/cards/:id/abandon', async (c) => {
    const body = await c.req.json().catch(() => ({})) as { stash_dirty?: boolean; actor?: controller.Actor };
    try {
        const result = controller.abandon(c.req.param('id'), {
            stashDirty: body.stash_dirty !== false,
            actor: body.actor,
        });
        if (!result) return c.json({ error: { code: 'not_found', message: 'card not found' } }, 404);
        return c.json(result);
    } catch (err: any) {
        return c.json({
            error: {
                code: err.code || 'abandon_failed',
                message: err.message,
                hint: err.hint,
                dirty_files: err.dirty_files,
            },
        }, 409);
    }
});

export default router;
