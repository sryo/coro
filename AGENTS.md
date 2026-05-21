# Concerto Agent

A kanban board for Claude Code conversations. One card = one Claude conversation = one git worktree. Multiple cards run in parallel without stepping on each other.

This document is the canonical reference for two audiences:

1. **Per-card runtime agents** — Claude Code conversations driving individual cards. The daemon injects the "Working on a card" section into the system prompt.
2. **Claude Code working on the concerto codebase itself** — read everything; the runtime section also tells you what your future agents will see.

See [PLAN.md](./PLAN.md) for the v0 design, schema, milestones, and reuse plan. See [design.md](./design.md) for the visual language.

---

## Working on a card

You're in a git worktree at `$GIT_COMMON_DIR/concerto-worktrees/<card-id>`, on branch `concerto/<slug>-<short-id>`, based off the project's base branch. Commit freely to your branch. The user owns the merge.

### MCP tools you have

The daemon hosts an MCP server scoped to your card:

- `concerto.get_card` — refresh metadata.
- `concerto.list_stages` — see the project's stages in order.
- `concerto.set_status` — move the card to a different stage. You **cannot** move to `done` or `merged`.
- `concerto.add_note` — append to the card's activity log (visible in the dashboard).
- `concerto.request_review` — mark ready for human review, with a one-paragraph summary.

### Rules

1. Don't auto-commit unless the user asks. The user owns git history.
2. Don't push, merge, or rebase unless explicitly asked.
3. Don't touch other cards' worktrees.
4. When work is testable, call `concerto.set_status({to_stage: 'Testing'})`.
5. When work feels complete, call `concerto.request_review` — never call `set_status` with `done` (the server will reject it; it's a human gate).
6. If the card's scope is wrong (too big, missing deps, depends on unfinished work), use `concerto.add_note` to flag it instead of ploughing on.

---

## Working on the concerto codebase

### Repo layout

```
packages/core/    runtime: db, claude driver, worktree, state machine, MCP tools
packages/daemon/  HTTP server (Hono) + CLI lifecycle
packages/skill/   Claude Code skill — verbs that talk to the daemon
dashboard/        Next.js dashboard (lands in M4)
```

### Conventions

- **One card = one conversation = one git worktree.** Don't conflate the three.
- **Worktrees live at `$GIT_COMMON_DIR/concerto-worktrees/<card-id>`** — invisible to `git status` in any working tree.
- **State machine is server-enforced.** On a rejected transition, the API returns `{ allowed: [...] }` so callers can self-correct once.
- **Stages are configurable per project** (DB strings, not enums). The `kind` field tags special-behavior stages (`backlog`, `ready`, `active`, `review`, `done`, `archive`).
- **The agent owns the conversation; the user owns commits.** Agents move cards up through `review` but never to `done` or `merged`.
- **Error envelope:** `{ error: { code, message, hint?, allowed? } }` with HTTP status matching the failure.

### Design

The dashboard and CLI follow [design.md](./design.md). When in doubt, cut.
