import { Hono } from 'hono';
import { projects } from '@concerto/core';

const router = new Hono();

router.get('/projects', (c) => c.json(projects.listProjects()));

router.get('/projects/by-path', (c) => {
    const repoPath = c.req.query('path');
    if (!repoPath) {
        return c.json({ error: { code: 'bad_request', message: 'path query param required' } }, 400);
    }
    const project = projects.getProjectByPath(repoPath);
    if (!project) {
        return c.json({
            error: {
                code: 'unbound',
                message: 'repo not bound to a project',
                hint: 'POST /projects with this path to bind it',
            },
        }, 404);
    }
    return c.json(project);
});

router.post('/projects', async (c) => {
    const body = await c.req.json().catch(() => null) as { name?: string; repo_path?: string; base_branch?: string } | null;
    if (!body?.repo_path) {
        return c.json({ error: { code: 'bad_request', message: 'repo_path required' } }, 400);
    }
    const existing = projects.getProjectByPath(body.repo_path);
    if (existing) return c.json(existing);
    const project = projects.createProject({
        name: body.name,
        repo_path: body.repo_path,
        base_branch: body.base_branch,
    });
    return c.json(project, 201);
});

router.get('/projects/:id', (c) => {
    const project = projects.getProject(c.req.param('id'));
    if (!project) return c.json({ error: { code: 'not_found', message: 'project not found' } }, 404);
    return c.json(project);
});

router.patch('/projects/:id', async (c) => {
    const body = await c.req.json().catch(() => null) as Record<string, unknown> | null;
    if (!body) return c.json({ error: { code: 'bad_request', message: 'json body required' } }, 400);
    const project = projects.updateProject(c.req.param('id'), body as any);
    if (!project) return c.json({ error: { code: 'not_found', message: 'project not found' } }, 404);
    return c.json(project);
});

export default router;
