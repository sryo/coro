#!/usr/bin/env node
// Resolves the current repo to a concerto project. Auto-binds if --auto-bind passed.
// Prints {project_id, project_name, repo_path} on success.
//
// Without --auto-bind, exits with code 3 and prints {reason: "unbound", repo_path, name}
// so the calling skill can prompt the user before binding.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

// Resolve @coro/client from the sibling daemon install (skill ships standalone,
// so we can't rely on node_modules lookup the way a packaged consumer would).
const here = path.dirname(fileURLToPath(import.meta.url));
const clientEntry = path.resolve(here, '..', '..', 'client', 'dist', 'index.js');
const { DaemonClient } = await import(clientEntry);

function logError(payload) {
    process.stderr.write('[concerto] ' + JSON.stringify(payload) + '\n');
}

function repoRoot() {
    try {
        return execSync('git rev-parse --show-toplevel', { encoding: 'utf8' }).trim();
    } catch {
        logError({ error: 'not in a git repo (run `git init` first)' });
        process.exit(1);
    }
}

const autoBind = process.argv.includes('--auto-bind');
const repo = repoRoot();
const client = new DaemonClient();

try {
    await client.ensureRunning();
} catch (err) {
    logError({ error: err?.message || String(err) });
    process.exit(1);
}

try {
    const project = await client.request(`/projects/by-path?path=${encodeURIComponent(repo)}`);
    process.stdout.write(JSON.stringify({
        project_id: project.id,
        project_name: project.name,
        repo_path: project.repo_path,
    }) + '\n');
    process.exit(0);
} catch (err) {
    if (err?.status !== 404) {
        logError({ error: err?.message || String(err) });
        process.exit(1);
    }
}

// Not bound.
const name = repo.split('/').pop() || 'project';

if (!autoBind) {
    process.stdout.write(JSON.stringify({ reason: 'unbound', repo_path: repo, name }) + '\n');
    process.exit(3);
}

const project = await client.request('/projects', { method: 'POST', body: { repo_path: repo, name } });
process.stdout.write(JSON.stringify({
    project_id: project.id,
    project_name: project.name,
    repo_path: project.repo_path,
    bound: true,
}) + '\n');
