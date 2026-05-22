import { Hono } from 'hono';
import { projects } from '@concerto/core';
import { httpError, parseJsonBody } from './_helpers';
import { createProjectBody, updateProjectBody } from './schemas';

const router = new Hono();

router.get('/projects', (c) => c.json(projects.listProjects()));

router.get('/projects/by-path', (c) => {
    const repoPath = c.req.query('path');
    if (!repoPath) {
        return httpError(c, 400, 'bad_request', 'path query param required');
    }
    const project = projects.getProjectByPath(repoPath);
    if (!project) {
        return httpError(c, 404, 'unbound', 'repo not bound to a project', {
            hint: 'POST /projects with this path to bind it',
        });
    }
    return c.json(project);
});

router.post('/projects', async (c) => {
    const parsed = await parseJsonBody(c, createProjectBody);
    if (!parsed.ok) return httpError(c, 400, 'bad_request', parsed.message);
    const body = parsed.data;
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
    if (!project) return httpError(c, 404, 'not_found', 'project not found');
    return c.json(project);
});

router.patch('/projects/:id', async (c) => {
    const parsed = await parseJsonBody(c, updateProjectBody);
    if (!parsed.ok) return httpError(c, 400, 'bad_request', parsed.message);
    const project = projects.updateProject(c.req.param('id'), parsed.data);
    if (!project) return httpError(c, 404, 'not_found', 'project not found');
    return c.json(project);
});

export default router;
