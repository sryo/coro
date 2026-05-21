# Concerto

A Kanban board for Claude Code conversations. Each card is a conversation. Each active card runs in its own git worktree so multiple agents can work in parallel without conflict. Distributed as a Claude Code skill + local companion daemon + Next.js dashboard.

See [PLAN.md](./PLAN.md) for the v0 design doc, architecture, schema, milestones, and reuse plan from Fonte.

See [AGENTS.md](./AGENTS.md) for the per-card Claude API surface (injected into the system prompt of each card's conversation).

See [design.md](./design.md) for the dashboard and CLI design language — eleven principles + the icon spec. Apply it everywhere there's a visible artifact: the dashboard, the skill's terminal output, the README. When in doubt, cut.

## Repo layout

```
packages/core/    runtime: db, claude driver, worktree, state machine, MCP tools
packages/daemon/  HTTP server + CLI lifecycle
packages/skill/   Claude Code skill — verbs that talk to the daemon
dashboard/        Next.js dashboard (lands in M4)
```

## No Claude/Anthropic attribution in commits

The `commit-msg` hook in `.githooks/` rejects messages with `Co-Authored-By` referencing Claude/Anthropic or a "Generated with Claude" footer. `npm install` activates the hook via the `prepare` script.

## Conventions

- One card = one Claude conversation = one git worktree. Don't conflate them.
- Worktrees live at `$GIT_COMMON_DIR/concerto-worktrees/<card-id>` — invisible to `git status`.
- State machine is server-enforced. On a rejected transition, the API returns `{ allowed: [...] }` so the caller can self-correct once.
- Stages are configurable per project (DB strings, not enums). `kind` field tags special-behavior stages (`review`, `done`, `archive`).
- The agent owns the conversation; the user owns commits. The agent can move a card up through `review` but never to `done` or `merged`.
