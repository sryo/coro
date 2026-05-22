---
name: coro-say
description: "Send a message to a coro card's Claude conversation and stream the response into this terminal. Use when the user wants to talk to the agent working on a specific card. The card must be in an active-kind stage (its worktree must exist). Auto-spawns the daemon and binds the repo if needed."
license: MIT
---

> Shared context: read `../coro/shared.md` first.

# /coro-say

Inputs:
- `card-id` (required) — full id, slug, or unambiguous prefix
- `message` (required) — what to send (multi-line ok)

Steps:

1. Resolve project + card (same disambiguation as `/coro-start`).

2. Verify the card has a worktree:
    - If `card.worktree_path` is null → tell the user "card needs to be started first" and suggest `/coro-start <card-id>`. Stop.

3. Build the JSON payload safely:
   ```sh
   PAYLOAD=$(jq -n --arg c "$MESSAGE" --arg cm "$(date +%s%N)" \
       '{content: $c, client_message_id: $cm}')
   ```

4. `POST /cards/<id>/messages` with the payload. Expect 202 Accepted with `{user_message_id, turn_id, queued: true}`.

5. Open the SSE stream `GET /cards/<id>/stream`. Pipe events into the terminal as they arrive:
    - `card:text_stream` → print/overwrite the assistant's in-progress text (one line, replace on update — claude rebroadcasts the full text on each event)
    - `card:message` with role=tool_use → print `[tool: <name>]` on its own line
    - `card:message` with role=tool_result → print `[result]` indented
    - `card:turn_complete` → print a blank line and exit
    - `card:error` → print the error and exit non-zero

6. On 404: card not found. On 409 with code=`card_not_active`: print the hint and stop.

If SSE is impractical (e.g. in a constrained shell), fall back to polling `GET /cards/<id>/messages?since_id=<last>` every 500ms until a row with role='assistant' and streaming_complete=1 appears, then print it.
