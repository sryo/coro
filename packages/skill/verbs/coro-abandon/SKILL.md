---
name: coro-abandon
description: "Abandon a coro card. Removes the card's git worktree and deletes the branch. If the worktree has uncommitted work, it's stashed to refs/coro-abandoned/<card-id> so it can be recovered later. Use when the user decides a card is wrong-headed or no longer needed."
license: MIT
---

> Shared context: read `../coro/shared.md` first.

# /coro-abandon

Inputs:
- `card-id` (required) — the full id, slug, or unambiguous prefix

Steps:

1. Resolve project + card (same as `/coro-start`).

2. Before calling the API, fetch the worktree status (`GET /cards/<id>/worktree`). If `dirty_files > 0`, tell the user:
   ```
   <N> uncommitted file(s) in the worktree. They'll be stashed to refs/coro-abandoned/<short-id> on abandon.
   Continue? [y/N]
   ```
   Stop unless they confirm.

3. `POST /cards/<id>/abandon` with `{stash_dirty: true, actor: 'user'}`.

4. On success, print:
   ```
   coro: abandoned
     card    <id>  <title>
   ```
   If `worktree.stashed_ref` is present, add:
   ```
     stash   <ref>  (recover with `git stash apply <ref>`)
   ```

5. On 404: card not found. On 409: print the error message and stop.

Note: this does NOT delete the card. The card row stays in the DB with `abandoned_at` set and is moved into the project's `abandoned`-kind stage (an immutable archive column, separate from `Merged`). To delete a backlog-only card, use `DELETE /cards/<id>` (not surfaced as a verb in v0).
