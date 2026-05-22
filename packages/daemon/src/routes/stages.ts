import { Hono } from 'hono';
import { stages, projects } from '@concerto/core';
import { httpError, parseJsonBody } from './_helpers';
import { replaceStagesBody } from './schemas';

const router = new Hono();

router.get('/projects/:id/stages', (c) => {
    const project = projects.getProject(c.req.param('id'));
    if (!project) return httpError(c, 404, 'not_found', 'project not found');
    return c.json(stages.listStages(project.id));
});

router.put('/projects/:id/stages', async (c) => {
    const project = projects.getProject(c.req.param('id'));
    if (!project) return httpError(c, 404, 'not_found', 'project not found');
    const parsed = await parseJsonBody(c, replaceStagesBody);
    if (!parsed.ok) return httpError(c, 400, 'bad_request', parsed.message);
    const result = stages.replaceStages(project.id, parsed.data.stages);
    if (!result.ok) {
        return httpError(c, 400, 'invalid_stages', result.reason);
    }
    return c.json(stages.listStages(project.id));
});

export default router;
