# Concerto Agent

A kanban for Claude Code conversations. One card = one conversation = one git worktree. Cards run in parallel without stepping on each other.

Two readers: the per-card runtime agent (daemon injects "Working on a card" as system prompt) and Claude Code on the concerto codebase (read all of it). See [PLAN.md](./PLAN.md) and [design.md](./design.md).

---

## Working on a card

You're in a git worktree at `$GIT_COMMON_DIR/concerto-worktrees/<card-id>`, on branch `concerto/<slug>-<short-id>`, based off the project's base branch. Commit freely. The user owns the merge.

### MCP tools

The daemon hosts an MCP server scoped to your card:

- `concerto.get_card` — refresh metadata.
- `concerto.list_stages` — see the project's stages in order.
- `concerto.set_status` — move the card. You **cannot** target `done` or `merged`.
- `concerto.add_note` — append to the card's activity log.
- `concerto.request_review` — mark ready for human review, with a one-paragraph summary.

### Rules

1. Don't auto-commit, push, merge, or rebase unless the user asks.
2. Don't touch other cards' worktrees.
3. When work is testable, say so in your reply. When work is complete, call `concerto.request_review` — the server rejects agent attempts at `done`.
4. If the scope is wrong, flag it with `add_note` instead of ploughing on.

---

## Working on the concerto codebase

### Layout

```
packages/core/    db, claude driver, worktree, state machine
packages/daemon/  HTTP server (Hono) + CLI lifecycle + MCP bridge
packages/types/   @concerto/types — shared interfaces
packages/client/  @concerto/client — DaemonClient: discover, ensureRunning, request, stream
packages/skill/   /concerto-* verbs
dashboard/        Next.js dashboard
```

### Conventions

- **One card = one conversation = one worktree.** Don't conflate.
- **Worktrees live at `$GIT_COMMON_DIR/concerto-worktrees/<card-id>`** — invisible to `git status` elsewhere.
- **State machine is server-enforced** via `controller.canMerge / canAbandon / canDelete / allowedTransitions` (see `packages/core/src/controller.ts`). Rejected transitions return `{ allowed: [...] }` so callers self-correct.
- **Stages are per-project strings.** The `kind` tag (`backlog`, `ready`, `active`, `review`, `done`, `archive`) drives behavior.
- **Agents move cards up through `review`; humans approve `done` and trigger `merged`.**
- **Error envelope:** `ErrorResponse` in `packages/types/src/index.ts` — fields include `conflicts?` for merge failures and `dirty_files?` for abandon failures.

The dashboard and CLI follow [design.md](./design.md). When in doubt, cut.
