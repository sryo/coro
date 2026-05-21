#!/usr/bin/env node
// Resolves the current repo to a concerto project. Auto-binds if --auto-bind passed.
// Prints {project_id, project_name, repo_path} on success.
//
// Without --auto-bind, exits with code 3 and prints {reason: "unbound", repo_path, name}
// so the calling skill can prompt the user before binding.

import { discover, api, repoRoot } from './api-client.mjs';

const autoBind = process.argv.includes('--auto-bind');
const repo = repoRoot();
const { port, token } = await discover();
const client = api(port, token);

try {
    const project = await client.get(`/projects/by-path?path=${encodeURIComponent(repo)}`);
    process.stdout.write(JSON.stringify({
        project_id: project.id,
        project_name: project.name,
        repo_path: project.repo_path,
    }) + '\n');
    process.exit(0);
} catch (err) {
    if (err.status !== 404) {
        console.error(JSON.stringify({ error: err.message }));
        process.exit(1);
    }
}

// Not bound.
const name = repo.split('/').pop() || 'project';

if (!autoBind) {
    process.stdout.write(JSON.stringify({ reason: 'unbound', repo_path: repo, name }) + '\n');
    process.exit(3);
}

const project = await client.post('/projects', { repo_path: repo, name });
process.stdout.write(JSON.stringify({
    project_id: project.id,
    project_name: project.name,
    repo_path: project.repo_path,
    bound: true,
}) + '\n');
