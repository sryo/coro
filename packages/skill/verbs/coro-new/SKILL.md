---
name: concerto-new
description: "Create a new card in the concerto board for this repo. Use when the user wants to capture an idea, task, or todo. The card lands in Backlog by default. The daemon and project binding auto-spawn if needed."
license: MIT
---

> Shared context: read `../concerto/shared.md` and `../concerto/schema.md` first.

# /concerto-new

Inputs (interactive or from arg parsing):
- `title` (required, ≤ 200 chars)
- `description` (optional, markdown)

Steps:

1. Resolve project: run `node <skill_dir>/../concerto/scripts/ensure-bound.mjs`. On exit code 3 (`{reason: "unbound"}`), ask the user "Bind this repo (<name>) to Concerto? [Y/n]". On yes, re-run with `--auto-bind`. On no, stop.

2. Read `~/.concerto/daemon.json` for `{port, token}`.

3. Build the JSON payload with `jq -n --arg t "$TITLE" --arg d "$DESCRIPTION" '{title: $t, description: $d}'` (never interpolate raw shell — see shared.md).

4. `POST http://localhost:<port>/projects/<project_id>/cards` with the payload and bearer token.

5. Print the result tersely:
   ```
   concerto: card created
     id     <id>
     slug   <slug>
     stage  Backlog
   ```

On 400/404/etc, print the `error.message` and the `error.hint` if present, then stop.
