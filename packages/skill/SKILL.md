---
name: concerto
description: "Kanban board for Claude Code conversations in this repo. Each card is a Claude conversation that runs in its own git worktree, so multiple cards can be worked in parallel. Use /concerto to open the board, /concerto-new to create a card, /concerto-start to begin work in a worktree. Run any concerto-* verb in any git repo; the daemon auto-spawns and the repo binds itself on first use."
license: MIT
---

> Shared context for every concerto-* skill. Read this and `shared.md` before any operation.

# Concerto — kanban for Claude Code conversations

One card = one Claude conversation = one git worktree.
Multiple cards run in parallel without stepping on each other.

## Verbs

- `/concerto` — open the board for this repo in the browser
- `/concerto-new` — create a card in Backlog
- `/concerto-list` — print the board as a table
- `/concerto-start` — create a worktree and begin work
- `/concerto-say` — send a message into a running card's conversation
- `/concerto-merge` — squash-merge a card's branch into the base
- `/concerto-abandon` — clean up a card's worktree (stashes dirty work)
- `/concerto-daemon` — daemon control: start, stop, status, logs

## Operating principles

1. Bind the repo by running `scripts/ensure-bound.mjs`. It auto-spawns the daemon if down and resolves (or registers) the current repo as a project.
3. Honor the state machine: on a 409 with `allowed[]`, retry once with `allowed[0]`. On a second failure, ask the user.
4. Never auto-commit on behalf of the agent. The user owns git history.
5. Don't reinvent: when a sibling verb exists, call it via `Skill(skill='concerto-<verb>')` rather than reimplementing.

## Where state lives

- Per-user secrets and DB: `~/.concerto/` (daemon.json, state.db, daemon.log)
- Per-repo state: none — projects are identified by canonical repo path; the daemon owns the binding.
- Per-card work: a git worktree at `$GIT_COMMON_DIR/concerto-worktrees/<card-id>` (invisible to `git status` in the main checkout).
