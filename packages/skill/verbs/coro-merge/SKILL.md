---
name: concerto-merge
description: "Squash-merge a concerto card's worktree into the project's base branch. Requires the card to be in a 'done' kind stage (i.e. the human has already approved it from Review). Cleans up the worktree and moves the card to the archive (Merged) stage. Use when the user has approved a card and wants to land the work."
license: MIT
---

> Shared context: read `../concerto/shared.md` first.

# /concerto-merge

Inputs:
- `card-id` (required) — the full id, slug, or unambiguous prefix
- `--message <msg>` (optional) — commit message; defaults to the card title

Steps:

1. Resolve project via `ensure-bound.mjs`. On unbound, ask once and bind.

2. Resolve the card (same lookup as `/concerto-start`).

3. Check the card's current stage. Fetch stages with `GET /projects/<project_id>/stages`. If the card's stage is not `kind === 'done'`, surface the issue clearly:
   - If `kind === 'review'` → tell the user "Card is in Review. Approve it first (dashboard) or move it to a Done stage manually." Stop.
   - Any other kind → "Card must be in a Done stage to merge (got '<current-stage-name>')." Stop.

4. POST `/cards/<id>/merge` with body:
   ```json
   { "strategy": "squash", "commit_message": "<--message or card.title>", "actor": "user" }
   ```

5. On 200, the response is `{ card, merge: { sha, strategy, already_merged } }`. Print:
   ```
   concerto: merged
     card     <id>  <title>
     branch   <previous branch_name from before>  →  <base_branch>
     commit   <sha7>  <commit_message>
     stage    <new-stage-name>   # Merged
   ```
   If `merge.already_merged === true`, prepend a note: "(branch was already in <base_branch>; no new commit was created)."

6. On 409 with `code === 'conflict'`:
   - The response includes `error.conflicts: string[]` (file paths). Print:
     ```
     concerto: merge conflict
       <file path>
       <file path>
       ...
     ```
   - Tell the user: "Resolve in the worktree, commit, then retry /concerto-merge."
   - Stop.

7. On 409 with `code === 'merge_requires_done'`: print the daemon's hint (asks the user to approve from Review first). Stop.

8. On other errors: surface the daemon's `error.message` and stop.

Important:
- Default strategy is squash. The plan reserves `strategy: 'merge'` (true merge commit) as an option; only pass it if the user explicitly asks.
- After a successful merge, the worktree and branch are gone. If the user's main working tree was checked out at the base branch, their on-disk files won't auto-update — git's ref advanced under them. Tell the user to run `git checkout <base>` or `git pull` (or whatever they prefer) to sync their working tree.
- This verb does NOT push. Pushing is the user's call.
