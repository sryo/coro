import { Hono } from 'hono';
import { stages, projects } from '@concerto/core';

const router = new Hono();

router.get('/projects/:id/stages', (c) => {
    const project = projects.getProject(c.req.param('id'));
    if (!project) return c.json({ error: { code: 'not_found', message: 'project not found' } }, 404);
    return c.json(stages.listStages(project.id));
});

router.put('/projects/:id/stages', async (c) => {
    const project = projects.getProject(c.req.param('id'));
    if (!project) return c.json({ error: { code: 'not_found', message: 'project not found' } }, 404);
    const body = await c.req.json().catch(() => null) as { stages?: stages.StageInput[] } | null;
    if (!body?.stages || !Array.isArray(body.stages)) {
        return c.json({ error: { code: 'bad_request', message: 'stages array required' } }, 400);
    }
    const result = stages.replaceStages(project.id, body.stages);
    if (!result.ok) {
        return c.json({ error: { code: 'invalid_stages', message: result.reason } }, 400);
    }
    return c.json(stages.listStages(project.id));
});

export default router;
