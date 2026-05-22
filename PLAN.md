# Coro

One card = one conversation = one git worktree.
Local daemon + Next.js board + Claude Code skill.

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
