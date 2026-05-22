---
name: coro-start
description: "Start work on a coro card. Transitions the card into the first 'active' kind stage of its project, which creates a git worktree on a fresh branch off the base. Use when the user wants to begin work on a specific card. The card id (or its slug or short prefix) is required."
license: MIT
---

> Shared context: read `../coro/shared.md` first.

# /coro-start

Inputs:
- `card-id` (required) — the full id, slug, or unambiguous prefix

Steps:

1. Resolve project via `ensure-bound.mjs`. On unbound, ask once and bind.

2. Resolve the card:
    - `GET /projects/<project_id>/cards` and find one whose `id`, `slug`, or `id` starts with the input.
    - If ambiguous: print matches and stop.
    - If none: print "no card matches '<input>'" and stop.

3. Find the target stage:
    - `GET /projects/<project_id>/stages`
    - Pick the FIRST stage with `kind === 'active'` (default: "In Progress")
    - If none exists (unusual — a stage was deleted), print an error and stop.

4. `POST /cards/<id>/transitions` with `{to_stage_id: <active>, actor: 'user'}`.

5. On success, the response is the updated card with `branch_name` and `worktree_path` populated. Print:
   ```
   coro: started
     card     <id>  <title>
     stage    <new-stage-name>
     branch   <branch_name>
     worktree <worktree_path>
   ```

6. On 409 with `allowed[]`: retry once with `allowed[0]` (per shared.md). On a second 409, surface the error message and stop.

After the transition lands, the worktree exists on disk — but the agent that runs IN the worktree (the per-card Claude conversation) is spawned by M3's conversation runner. For now, the user can cd into the worktree manually.
