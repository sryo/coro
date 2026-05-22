import { Hono } from 'hono';
import { stages, projects } from '@concerto/core';
import { httpError } from './_helpers';

const router = new Hono();

router.get('/projects/:id/stages', (c) => {
    const project = projects.getProject(c.req.param('id'));
    if (!project) return httpError(c, 404, 'not_found', 'project not found');
    return c.json(stages.listStages(project.id));
});

router.put('/projects/:id/stages', async (c) => {
    const project = projects.getProject(c.req.param('id'));
    if (!project) return httpError(c, 404, 'not_found', 'project not found');
    const body = await c.req.json().catch(() => null) as { stages?: stages.StageInput[] } | null;
    if (!body?.stages || !Array.isArray(body.stages)) {
        return httpError(c, 400, 'bad_request', 'stages array required');
    }
    const result = stages.replaceStages(project.id, body.stages);
    if (!result.ok) {
        return httpError(c, 400, 'invalid_stages', result.reason);
    }
    return c.json(stages.listStages(project.id));
});

export default router;
