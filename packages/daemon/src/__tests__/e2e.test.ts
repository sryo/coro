import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { execFileSync } from 'node:child_process';
import type { Server } from 'node:http';

// Each test file gets a fresh CORO_HOME so its sqlite db, daemon.json, and
// log file live in a private tmpdir. CORO_HOME must be set before any core
// module loads, because config.ts captures it once at import time.
const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'coro-e2e-'));
process.env.CORO_HOME = tmpHome;

type ServerMod = {
    startServer: typeof import('../server').startServer;
    generateToken: typeof import('../auth').generateToken;
};
type CoreMod = {
    closeDb: typeof import('@coro/core').closeDb;
    stages: typeof import('@coro/core').stages;
};

function git(cwd: string, args: string[]): string {
    return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function makeTmpRepo(): string {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'coro-e2e-repo-'));
    git(repo, ['init', '-q', '-b', 'main']);
    git(repo, ['config', 'user.email', 'e2e@example.com']);
    git(repo, ['config', 'user.name', 'E2E']);
    git(repo, ['config', 'commit.gpgsign', 'false']);
    fs.writeFileSync(path.join(repo, 'README.md'), '# e2e\n');
    git(repo, ['add', '-A']);
    git(repo, ['commit', '-q', '-m', 'initial']);
    return repo;
}

// Bind a TCP socket to :0, read the kernel-assigned port, then close. Avoids
// hardcoding a port that might collide with the user's real daemon.
async function freePort(): Promise<number> {
    return new Promise((resolve, reject) => {
        const srv = net.createServer();
        srv.unref();
        srv.on('error', reject);
        srv.listen(0, '127.0.0.1', () => {
            const addr = srv.address();
            if (typeof addr === 'object' && addr) {
                const port = addr.port;
                srv.close(() => resolve(port));
            } else {
                reject(new Error('no addr'));
            }
        });
    });
}

describe('daemon end-to-end', () => {
    let server: Server;
    let baseUrl: string;
    let token: string;
    let repoPath: string;
    let coreMod: CoreMod;
    let auth: { Authorization: string };

    beforeAll(async () => {
        const serverMod = await import('../server') as unknown as ServerMod;
        const authMod = await import('../auth') as unknown as ServerMod;
        coreMod = {
            closeDb: (await import('@coro/core')).closeDb,
            stages: (await import('@coro/core')).stages,
        };
        token = authMod.generateToken();
        auth = { Authorization: `Bearer ${token}` };
        const port = await freePort();
        server = serverMod.startServer({ port, token, startedAt: Date.now() });
        baseUrl = `http://127.0.0.1:${port}`;
        repoPath = makeTmpRepo();

        // Wait for /health to come up so the first POST doesn't race startup.
        for (let i = 0; i < 50; i++) {
            try {
                const res = await fetch(`${baseUrl}/health`, { headers: auth });
                if (res.ok) return;
            } catch {}
            await new Promise((r) => setTimeout(r, 50));
        }
        throw new Error('daemon never became healthy');
    });

    afterAll(async () => {
        await new Promise<void>((resolve) => server?.close(() => resolve()));
        try { coreMod.closeDb(); } catch {}
        try { fs.rmSync(tmpHome, { recursive: true, force: true }); } catch {}
        try { fs.rmSync(repoPath, { recursive: true, force: true }); } catch {}
    });

    it('binds, creates, transitions, and merges a card end-to-end', async () => {
        // 1) Bind the temp repo as a project.
        const projectRes = await fetch(`${baseUrl}/projects`, {
            method: 'POST',
            headers: { ...auth, 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: 'e2e', repo_path: repoPath, base_branch: 'main' }),
        });
        expect(projectRes.status).toBe(201);
        const project = await projectRes.json() as { id: string; base_branch: string };
        expect(project.id).toBeTruthy();
        expect(project.base_branch).toBe('main');

        // 2) Default stages are seeded by createProject; resolve the ones we need.
        const stages = coreMod.stages.listStages(project.id);
        const inProgress = stages.find((s) => s.kind === 'active');
        const review = stages.find((s) => s.kind === 'review');
        const done = stages.find((s) => s.kind === 'done');
        const archive = stages.find((s) => s.kind === 'archive');
        const backlog = stages.find((s) => s.kind === 'backlog');
        expect(inProgress).toBeDefined();
        expect(review).toBeDefined();
        expect(done).toBeDefined();
        expect(archive).toBeDefined();
        expect(backlog).toBeDefined();

        // 3) Create a card in backlog.
        const cardRes = await fetch(`${baseUrl}/projects/${project.id}/cards`, {
            method: 'POST',
            headers: { ...auth, 'Content-Type': 'application/json' },
            body: JSON.stringify({ title: 'e2e test' }),
        });
        expect(cardRes.status).toBe(201);
        const card = await cardRes.json() as { id: string; stage_id: string; title: string };
        expect(card.title).toBe('e2e test');
        expect(card.stage_id).toBe(backlog!.id);

        // 4) Move to In Progress; worktree directory must exist on disk.
        const t1 = await fetch(`${baseUrl}/cards/${card.id}/transitions`, {
            method: 'POST',
            headers: { ...auth, 'Content-Type': 'application/json' },
            body: JSON.stringify({ actor: 'user', to_stage_id: inProgress!.id }),
        });
        expect(t1.status).toBe(200);
        const inProg = await t1.json() as { stage_id: string; worktree_path: string | null; branch_name: string | null };
        expect(inProg.stage_id).toBe(inProgress!.id);
        expect(inProg.worktree_path).toBeTruthy();
        expect(fs.existsSync(inProg.worktree_path!)).toBe(true);
        expect(inProg.branch_name).toMatch(/^coro\//);

        // Add a commit in the worktree so the merge has work to land and produces
        // a real squash commit (not a no-op already_merged result).
        fs.writeFileSync(path.join(inProg.worktree_path!, 'feature.txt'), 'hello from e2e\n');
        git(inProg.worktree_path!, ['add', '-A']);
        git(inProg.worktree_path!, ['-c', 'user.email=e2e@example.com', '-c', 'user.name=E2E',
            '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'feature']);

        // 5) Move to Review.
        const t2 = await fetch(`${baseUrl}/cards/${card.id}/transitions`, {
            method: 'POST',
            headers: { ...auth, 'Content-Type': 'application/json' },
            body: JSON.stringify({ actor: 'user', to_stage_id: review!.id }),
        });
        expect(t2.status).toBe(200);
        expect((await t2.json() as { stage_id: string }).stage_id).toBe(review!.id);

        // 6) Move to Done (only user can promote out of review).
        const t3 = await fetch(`${baseUrl}/cards/${card.id}/transitions`, {
            method: 'POST',
            headers: { ...auth, 'Content-Type': 'application/json' },
            body: JSON.stringify({ actor: 'user', to_stage_id: done!.id }),
        });
        expect(t3.status).toBe(200);
        expect((await t3.json() as { stage_id: string }).stage_id).toBe(done!.id);

        // Capture branch + worktree path before merge so we can assert teardown.
        const branch = inProg.branch_name!;
        const worktreePath = inProg.worktree_path!;

        // 7) Merge: archive stage, sha returned, worktree directory removed, branch deleted.
        const mergeRes = await fetch(`${baseUrl}/cards/${card.id}/merge`, {
            method: 'POST',
            headers: { ...auth, 'Content-Type': 'application/json' },
            body: JSON.stringify({}),
        });
        expect(mergeRes.status).toBe(200);
        const merged = await mergeRes.json() as {
            card: { stage_id: string; worktree_path: string | null; branch_name: string | null };
            merge: { sha: string; strategy: string; already_merged: boolean };
        };
        expect(merged.card.stage_id).toBe(archive!.id);
        expect(merged.card.worktree_path).toBeNull();
        expect(merged.card.branch_name).toBeNull();
        expect(merged.merge.sha).toMatch(/^[0-9a-f]{40}$/);
        expect(merged.merge.strategy).toBe('squash');
        expect(merged.merge.already_merged).toBe(false);
        expect(fs.existsSync(worktreePath)).toBe(false);

        // Branch should be gone from the base repo.
        const branches = git(repoPath, ['for-each-ref', '--format=%(refname:short)', 'refs/heads/']);
        expect(branches.split('\n')).not.toContain(branch);
    });
});
