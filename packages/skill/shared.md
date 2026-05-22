# Shared context for coro skills

## Daemon discovery

1. Read `~/.coro/daemon.json`. Expect `{ port, token, pid, started_at }`.
2. Probe `GET http://localhost:<port>/health` with header `Authorization: Bearer <token>`.
3. If 200 → use it.
4. If anything else → run `coro daemon start` (or the bundled `coro-daemon-start` script) and re-probe for up to 3 seconds.
5. Still down → tell the user to check `coro daemon logs`. Stop.

`scripts/ensure-bound.mjs` handles steps 1–4 transparently — it auto-spawns the daemon via `@coro/client` if needed and exits with the project info on stdout.

## Project binding

1. `git rev-parse --show-toplevel` → canonical repo path. Refuse to operate outside a git repo.
2. `GET /projects/by-path?path=<canonical>` with the bearer token.
3. If 200 → use the returned project id.
4. If 404 with `{ reason: "unbound" }` → ask the user "Bind this repo to Coro? [Y/n]". On yes, `POST /projects { name: <basename>, repo_path }`. Re-fetch and use the new id.

The script `scripts/ensure-bound.mjs` does this and prints the `project_id`.

## State machine

- Stages are per-project. Always call `GET /projects/:id/stages` to learn the legal set.
- Transition a card: `POST /cards/:id/transitions { to_stage_id, actor: 'user', reason? }`.
- On 409 with `{ error: { allowed: [stage_id, ...] } }`, retry exactly once with `allowed[0]`. On a second 409, ask the user.
- Two stages are special, by `kind`:
    - `done` is reachable only from `review` AND only with `actor: 'user'` (human gate).
    - `archive` is reachable only via `POST /cards/:id/merge` (not via plain transition).

## Talking to the API safely

Build JSON payloads with `jq -n --arg`, or with `node -e "process.stdout.write(JSON.stringify(...))"`. Never `curl -d "{\"title\": \"$TITLE\"}"` — a card title with a quote or newline breaks the shell.

Pattern that always works:

```sh
PAYLOAD=$(jq -n --arg t "$TITLE" --arg d "$DESCRIPTION" '{title: $t, description: $d}')
curl -sf -X POST -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d "$PAYLOAD" \
    "http://localhost:$PORT/projects/$PROJECT_ID/cards"
```

## Error envelope

All errors return JSON of shape:

```json
{ "error": { "code": "string", "message": "string", "hint": "string?", "allowed": ["..."] } }
```

The HTTP status code matches the failure (400, 401, 404, 409, 500). The `allowed` field is present on state-machine 409s.

## Auth

Token from `~/.coro/daemon.json`, sent as `Authorization: Bearer <token>`. Localhost-only. The file is `chmod 600`.
