import fs from 'node:fs';
import path from 'node:path';
import { Hono } from 'hono';
import { z } from 'zod';
import { projects } from '@coro/core';
import { httpError, parseJsonBody } from './_helpers';

const router = new Hono();

// Curated whitelist of project-level docs. Any file outside this set is rejected
// to keep the endpoint a fixed-shape doc editor rather than a generic FS browser.
const ALLOWED_FILES = ['README.md', 'PLAN.md', 'AGENTS.md', 'CLAUDE.md'] as const;
const ALLOWED_SET: ReadonlySet<string> = new Set(ALLOWED_FILES);

function resolveInRepo(repoPath: string, name: string): string | null {
    if (!ALLOWED_SET.has(name)) return null;
    const repoRoot = path.resolve(repoPath);
    const resolved = path.resolve(repoRoot, name);
    if (resolved !== repoRoot && !resolved.startsWith(repoRoot + path.sep)) return null;
    return resolved;
}

const writeBody = z.object({ content: z.string().max(1_000_000) }).strict();

router.get('/projects/:id/files', (c) => {
    const project = projects.getProject(c.req.param('id'));
    if (!project) return httpError(c, 404, 'project_not_found', 'project not found');

    const files = ALLOWED_FILES.map((name) => {
        const filePath = resolveInRepo(project.repo_path, name);
        if (!filePath) return { name, exists: false };
        try {
            const stat = fs.statSync(filePath);
            if (!stat.isFile()) return { name, exists: false };
            return { name, exists: true, size: stat.size, mtime: stat.mtimeMs };
        } catch {
            return { name, exists: false };
        }
    });
    return c.json({ files });
});

router.get('/projects/:id/files/:name', (c) => {
    const project = projects.getProject(c.req.param('id'));
    if (!project) return httpError(c, 404, 'project_not_found', 'project not found');
    const filePath = resolveInRepo(project.repo_path, c.req.param('name'));
    if (!filePath) return httpError(c, 400, 'bad_request', 'file not in allowed set');
    try {
        const content = fs.readFileSync(filePath, 'utf8');
        return c.json({ name: c.req.param('name'), content });
    } catch (err: any) {
        if (err?.code === 'ENOENT') return c.json({ name: c.req.param('name'), content: '' });
        return httpError(c, 500, 'read_failed', err?.message || 'read failed');
    }
});

router.put('/projects/:id/files/:name', async (c) => {
    const project = projects.getProject(c.req.param('id'));
    if (!project) return httpError(c, 404, 'project_not_found', 'project not found');
    const filePath = resolveInRepo(project.repo_path, c.req.param('name'));
    if (!filePath) return httpError(c, 400, 'bad_request', 'file not in allowed set');
    const parsed = await parseJsonBody(c, writeBody);
    if (!parsed.ok) return httpError(c, 400, 'bad_request', parsed.message);
    try {
        fs.writeFileSync(filePath, parsed.data.content);
        return c.json({ ok: true });
    } catch (err: any) {
        return httpError(c, 500, 'write_failed', err?.message || 'write failed');
    }
});

export default router;
