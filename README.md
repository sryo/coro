# Concerto

A Kanban board for Claude Code conversations.

One card = one Claude conversation = one git worktree. Cards run in parallel without stepping on each other. Ships as a Claude Code skill, a local daemon, and a Next.js dashboard.

**Status:** v0, pre-alpha. See [PLAN.md](./PLAN.md) for the design doc and [AGENTS.md](./AGENTS.md) for the agent + codebase conventions.

---

## Install

Not on npm yet. From a clone:

```sh
git clone https://github.com/<you>/concerto.git
cd concerto
npm install
npm run build
npm link                      # puts `concerto` on your PATH
packages/skill/install.sh     # links /concerto-* skills into ~/.claude/skills/
```

Run the dashboard in a second terminal:

```sh
cd dashboard
npm install
npm run dev                   # http://localhost:7420
```

The daemon auto-spawns on the first `/concerto-*` call. Manual controls:

```sh
concerto daemon start         # writes pid + token to ~/.concerto/daemon.json
concerto daemon status        # health probe
concerto daemon logs          # tail ~/.concerto/daemon.log
```

---

## Walkthrough

```
cd ~/code/my-project
/concerto-new "fix the login redirect"
```

First run in a new repo binds it (keyed by `git rev-parse --show-toplevel`) and lands the card in **Backlog**.

```
/concerto-start <card-id>
```

Creates a worktree at `$GIT_COMMON_DIR/concerto-worktrees/<card-id>` on a fresh `concerto/<slug>-<short-id>` branch, moves the card to the first **active** stage, and writes `.mcp.json` so the per-card Claude picks up `concerto.*` tools. Any prefix of the card id works.

```
/concerto-say <card-id> "start with the redirect param, then check the cookie domain"
```

The reply streams into the terminal and the dashboard. Board cues:

- Animated dot — agent mid-turn
- Orange dot — uncommitted changes
- Red dot — last merge attempt conflicted
- "rebase" badge — >10 commits behind base
- "worktree missing" — worktree gone from disk

The agent moves itself between active stages and calls `concerto.request_review` when it's done. Only a human can move a card to **Done**.

```
/concerto-merge <card-id>
```

Precheck with `git merge-tree` (conflict → 409 with file list, card stamped red, worktree kept). Clean → squash-merge into the base branch, remove the worktree, archive the card.

```
/concerto-abandon <card-id>
```

Removes the worktree. Uncommitted work is stashed to `refs/concerto-abandoned/<card-id>` for 30 days.

---

## Layout

```
concerto/
├── packages/
│   ├── core/        db, claude driver, worktree, state machine, MCP tools
│   ├── daemon/      HTTP server (Hono), CLI entry, MCP bridge
│   └── skill/       /concerto + /concerto-* verb skills
└── dashboard/       Next.js app
```

- DB: `~/.concerto/state.db` (SQLite, WAL).
- Daemon: `http://localhost:7419`, bearer token in `~/.concerto/daemon.json` (chmod 600).
- Dashboard: `http://localhost:7420`.

See [AGENTS.md](./AGENTS.md) for conventions and [PLAN.md](./PLAN.md) §5 for the state machine, §10 for milestones.
