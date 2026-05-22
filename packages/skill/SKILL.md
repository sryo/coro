---
name: coro
description: "Kanban board to run Claude Code conversations in parallel."
license: MIT
---

> Shared context for every coro-* skill. Read this and `shared.md` before any operation.

# Coro — kanban for Claude Code conversations

One card = one Claude conversation = one git worktree.
Multiple cards run in parallel without stepping on each other.

## Verbs

- `/coro` — open the board for this repo in the browser
- `/coro-new` — create a card in Backlog
- `/coro-list` — print the board as a table
- `/coro-start` — create a worktree and begin work
- `/coro-say` — send a message into a running card's conversation
- `/coro-merge` — squash-merge a card's branch into the base
- `/coro-abandon` — clean up a card's worktree (stashes dirty work)
- `/coro-daemon` — daemon control: start, stop, status, logs

## Operating principles

1. Bind the repo by running `scripts/ensure-bound.mjs`. It auto-spawns the daemon if down and resolves (or registers) the current repo as a project.
3. Honor the state machine: on a 409 with `allowed[]`, retry once with `allowed[0]`. On a second failure, ask the user.
4. Never auto-commit on behalf of the agent. The user owns git history.
5. Don't reinvent: when a sibling verb exists, call it via `Skill(skill='coro-<verb>')` rather than reimplementing.

## Where state lives

- Per-user secrets and DB: `~/.coro/` (daemon.json, state.db, daemon.log)
- Per-repo state: none — projects are identified by canonical repo path; the daemon owns the binding.
- Per-card work: a git worktree at `$GIT_COMMON_DIR/coro-worktrees/<card-id>` (invisible to `git status` in the main checkout).
