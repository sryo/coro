# Coro

A Kanban board for Claude Code conversations.

One card = one Claude conversation = one git worktree. Cards run in parallel without stepping on each other. Ships as a Claude Code skill, a local daemon, and a Next.js dashboard.

---

## Install

Not on npm yet. From a clone:

```sh
git clone https://github.com/<you>/coro.git
cd coro
npm install
npm run build
npm link                      # puts `coro` on your PATH
packages/skill/install.sh     # links /coro-* skills into ~/.claude/skills/
```

Run the dashboard in a second terminal:

```sh
cd dashboard
npm install
npm run dev                   # http://localhost:7420
```

The daemon auto-spawns on the first `/coro-*` call. Manual: `coro daemon {start,status,logs}` (state in `~/.coro/`).

---

## Walkthrough

```
cd ~/code/my-project
/coro-new "fix the login redirect"
```

First run in a new repo binds it and lands the card in **Backlog**.

```
/coro-start <card-id>
```

Creates a worktree at `$GIT_COMMON_DIR/coro-worktrees/<card-id>` on a fresh `coro/<slug>-<short-id>` branch, moves the card to the first **active** stage, and writes `.mcp.json` so the per-card Claude picks up `coro.*` tools.

```
/coro-say <card-id> "start with the redirect param, then check the cookie domain"
```

The reply streams into the terminal and the dashboard. Board dots signal turn activity, uncommitted changes, and conflicted merges; rebase and worktree-missing warnings live on card detail.

The agent moves itself between active stages and calls `coro.request_review` when it's done. Only a human can move a card to **Done**.

```
/coro-merge <card-id>
```

Precheck with `git merge-tree` (conflict → 409 with file list, card stamped red, worktree kept). Clean → squash-merge into the base branch, remove the worktree, archive the card.

```
/coro-abandon <card-id>
```

Removes the worktree. Uncommitted work is stashed to `refs/coro-abandoned/<card-id>` for 30 days.

---

## Layout

```
coro/
├── packages/
│   ├── core/        db, claude driver, worktree, state machine
│   ├── daemon/      HTTP server (Hono), CLI entry, MCP bridge
│   ├── types/       @coro/types — shared interfaces
│   ├── client/      @coro/client — DaemonClient: discover, ensureRunning, request, stream
│   └── skill/       /coro + /coro-* verb skills
└── dashboard/       Next.js app
```

DB at `~/.coro/state.db` (SQLite, WAL). Daemon on `http://localhost:7419` (bearer token in `~/.coro/daemon.json`, chmod 600). Dashboard on `http://localhost:7420`. See [AGENTS.md](./AGENTS.md), [PLAN.md](./PLAN.md), and [design.md](./design.md).
