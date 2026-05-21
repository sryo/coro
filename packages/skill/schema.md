# Concerto data model

## Project

```
id            string  nanoid
name          string  display name (defaults to basename of repo_path)
repo_path     string  canonical absolute path from `git rev-parse --show-toplevel`
base_branch   string  the branch cards merge into (default 'main')
default_model string? Claude model id used for cards in this project
project_brief string? 200-500 chars, injected into every card's system prompt
created_at    number  ms since epoch
```

## Stage

A column in the project's kanban board. Stages are configurable per project.

```
id          string
project_id  string
name        string  e.g. 'Backlog', 'Review'
position    number  column order, unique within project
kind        enum    'backlog' | 'ready' | 'active' | 'review' | 'done' | 'archive'
```

`kind` drives special behavior:
- `backlog`, `ready` — no worktree exists yet
- `active` — worktree exists; agent may be running
- `review` — worktree exists; human-only gate to leave this stage upward
- `done` — work acknowledged-good, not yet merged
- `archive` — work merged; cards in this stage are immutable

Default stages on project creation: Backlog → Ready → In Progress → Testing → Review → Done → Merged.

## Card

```
id              string  nanoid
project_id      string
slug            string  kebab(title) trimmed to 40 chars
title           string  ≤ 200 chars
description     string? markdown; may contain "Depends on: #ID" lines
stage_id        string  current column
branch_name     string? null until first transition to an 'active' stage
worktree_path   string? null until first transition to an 'active' stage
base_sha        string? sha the worktree was forked from
model_override  string? per-card model override
position        number  order within stage column
created_at      number
updated_at      number
started_at      number? first time card entered an 'active' stage
testing_at      number?
review_at       number?
done_at         number?
merged_at       number?
abandoned_at    number?
```

## Message

A turn in a card's conversation. Structured to preserve tool calls (not flatten them to `[tool: name]` text).

```
id                  number  autoincrement
conversation_id     string
message_id          string  client-supplied or generated; for dedup
turn_id             string  groups messages of one assistant turn
role                enum    'user' | 'assistant' | 'tool_use' | 'tool_result' | 'system'
content_text        string? for user/assistant/system
content_json        string? for tool_use/tool_result (structured JSON)
tool_name           string? for tool_use rows
streaming_complete  bool
created_at          number
```

## Worktree

```
id           string
card_id      string  unique
path         string  $GIT_COMMON_DIR/concerto-worktrees/<card-id>
branch       string  concerto/<slug>-<short-id>
base_branch  string
base_sha     string
state        enum    'active' | 'merged' | 'abandoned' | 'missing'
last_seen_at number  updated on each reconciliation sweep
created_at   number
```

## Event

Append-only audit log. Powers the dashboard activity feed and reconciliation logic.

```
id            number
card_id       string?
kind          string  'stage_change' | 'message' | 'commit_detected' | 'worktree_created' | ...
actor         enum    'user' | 'agent' | 'system'
payload_json  string  structured payload (varies by kind)
created_at    number
```
