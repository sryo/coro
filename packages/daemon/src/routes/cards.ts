import { Hono } from 'hono';
import { cards, projects, stages } from '@concerto/core';

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
    try {
        const ok = cards.deleteCard(c.req.param('id'));
        if (!ok) return c.json({ error: { code: 'not_found', message: 'card not found' } }, 404);
        return c.json({ ok: true });
    } catch (err: any) {
        const stage = cards.getCard(c.req.param('id'));
        const allowed = stage ? stages.listStages(stage.project_id).filter(s => s.kind === 'backlog').map(s => s.id) : [];
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

export default router;
