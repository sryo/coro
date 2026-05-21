# Concerto

See [AGENTS.md](./AGENTS.md) for the canonical reference — it covers both the per-card runtime agent (injected as system prompt by the daemon) and Claude Code working on this codebase.

See [PLAN.md](./PLAN.md) for the v0 design doc.

## No Claude/Anthropic attribution in commits

This repo's `commit-msg` hook (in `.githooks/`) rejects any commit message containing a `Co-Authored-By` trailer that references the assistant or the vendor, or a "Generated with Claude" footer. `npm install` activates the hook via the `prepare` script. The same rule lives globally in `~/.claude/CLAUDE.md`.
