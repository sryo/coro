# Concerto — v0 Plan

One card = one conversation = one git worktree.
Local daemon + Next.js board + Claude Code skill.

## v0 delivers
- per-card worktree + Claude conversation
- configurable stages (default: Backlog → Ready → In Progress → Testing → Review → Done → Merged)
- server-enforced state machine with `{ allowed: [...] }` recovery hints
- squash-merge / abandon-with-stash / 30-day recovery
- MCP tools so agents self-transition; humans gate Done + Merged
- dashboard with SSE live updates

## v1 deferral
- multi-user / shared daemon / auth
- gh pr create integration
- auto-merge policies
- per-card model override UI
- .env / node_modules symlink policy for worktrees
- card templates & cross-card dependencies
- custom-stage editor UI (API exists; UI deferred)

## Milestones
- M1: projects, stages, cards CRUD + binding (commit b79c437)
- M2: worktree manager + state machine (commit 67b1f4e)
- M3: per-card Claude conversation runner (commit f8ec83f)
- Rearchitect v0.1: @concerto/types + @concerto/client, zod at routes,
  standard error envelope, SSE-only dashboard, MCP moved from core
  to daemon, structured logging, Vitest + in-process e2e (19 commits)

## Code is truth
- state machine → packages/core/src/controller.ts
- HTTP API → packages/daemon/src/routes/
- worktree / git ops → packages/core/src/worktree.ts
- db schema → packages/core/src/db.ts migrations
- daemon client → packages/client/src/index.ts
- skill verbs → packages/skill/verbs/

## Open questions
- repeated short turns vs. long sessions per card
- daemon socket vs. localhost HTTP for future remote use
- card archival/snapshot beyond 30-day stash
