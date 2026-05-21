# Concerto — v0 Implementation Plan

**Codename:** `concerto` (npm conflict noted — likely needs scoping or renaming before public release)
**Goal:** A Kanban board for Claude Code conversations. One card = one conversation = one git worktree. Importable into any project via a Claude Code skill that talks to a local companion daemon.

---

## 1. Scope and non-goals

### In scope for v0
1. Local-only single-user daemon, auto-spawned by the skill
2. Per-card git worktree (invisible: `$GIT_COMMON_DIR/concerto-worktrees/<card-id>`) with one Claude conversation
3. Configurable stages per project (default set: Backlog → Ready → In Progress → Testing → Review → Done → Merged)
4. Server-enforced state machine with `.allowed[]` self-correction hint
5. Next.js dashboard: board view with drag-drop, card detail with conversation + diff
6. MCP tools the agent can call to self-transition (up through Review)
7. Squash merge on Done → Merged transition (auto-stash on Abandon)
8. Skill with verbs: `/concerto`, `/concerto new`, `/concerto list`, `/concerto start`, `/concerto say`, `/concerto merge`, `/concerto abandon`, `/concerto daemon`

### Explicitly deferred to v1+
- Multi-user / shared daemon / auth beyond local-only
- `gh pr create` integration (TBD per user)
- Anchor-task / seed flow (`/concerto seed <vague idea>`)
- Heartbeat / stagnant-card detection
- Custom-stage editor in the UI (v0 reads config from a file; v1 adds in-app editor)
- Token budget tracking with hard stops
- Multiple Claude models per card
- Card templates
- Cross-card dependencies (`Depends on: #N` parsing) — schema-ready, no UI yet
- `node_modules` / `.env` symlink policy (v0 documents the footgun, v1 adds config)

---

## 2. Repo layout

```
concerto/
├── package.json                          # npm workspaces root
├── tsconfig.base.json
├── tsconfig.json
├── .githooks/
│   └── commit-msg                        # copy from fonte (block AI attribution)
├── CLAUDE.md                             # mirrors fonte's pattern
├── AGENTS.md                             # describes the daemon API for the per-card Claude
├── README.md
├── packages/
│   ├── core/                             # runtime: db, claude driver, worktree, state machine
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── index.ts                  # public exports
│   │       ├── config.ts                 # CONCERTO_HOME, ports, defaults
│   │       ├── events.ts                 # emitEvent/onEvent (from fonte logging.ts)
│   │       ├── db.ts                     # better-sqlite3 init + migrations
│   │       ├── migrations/
│   │       │   ├── 001_initial.sql
│   │       │   └── _migrate.ts
│   │       ├── claude/
│   │       │   ├── driver.ts             # from fonte adapters/claude.ts
│   │       │   ├── subprocess.ts         # from fonte invoke.ts (runCommandStreaming only)
│   │       │   ├── events.ts             # ClaudeEvent type (structured, not flat)
│   │       │   └── prompt.ts             # tiny system-prompt builder for cards
│   │       ├── cards.ts                  # CRUD + transition logic
│   │       ├── conversations.ts          # message persistence + chain serialization
│   │       ├── projects.ts               # project registry (repo path → project)
│   │       ├── worktree.ts               # git worktree CRUD
│   │       ├── stages.ts                 # configurable state machine
│   │       ├── controller.ts             # CardController (per-card lifecycle orchestrator)
│   │       └── mcp/
│   │           ├── server.ts             # MCP server the per-card Claude connects to
│   │           └── tools.ts              # tool definitions: set_status, add_note, etc.
│   ├── daemon/                           # HTTP server + lifecycle
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── bin/concerto.mjs              # CLI entry
│   │   └── src/
│   │       ├── index.ts                  # daemon entry (from fonte main/index.ts)
│   │       ├── cli.ts                    # start/stop/status/logs (from fonte cli/daemon.ts)
│   │       ├── server.ts                 # Hono setup (from fonte server/index.ts)
│   │       ├── sse.ts                    # from fonte server/sse.ts
│   │       ├── auth.ts                   # bearer token in ~/.concerto/daemon.json
│   │       └── routes/
│   │           ├── health.ts
│   │           ├── projects.ts
│   │           ├── cards.ts              # CRUD + transitions
│   │           ├── messages.ts           # from fonte routes/messages.ts (heavily simplified)
│   │           ├── stream.ts             # per-card SSE
│   │           ├── worktree.ts           # status, diff, files-touched
│   │           └── merge.ts
│   └── skill/                            # the Claude Code skill
│       ├── package.json
│       ├── SKILL.md                      # the "shared library" skill — owns shared.md content
│       ├── shared.md                     # auth resolution, daemon URL, state machine ref
│       ├── schema.md                     # data model + JSON field formats
│       ├── scripts/
│       │   ├── discover-daemon.mjs       # find daemon, auto-spawn if down
│       │   ├── api-client.mjs            # thin HTTP client
│       │   └── ensure-bound.mjs          # bind repo to project on first use
│       ├── verbs/                        # per-verb sub-skills (each references ../shared.md)
│       │   ├── concerto-new/SKILL.md
│       │   ├── concerto-list/SKILL.md
│       │   ├── concerto-start/SKILL.md
│       │   ├── concerto-say/SKILL.md
│       │   ├── concerto-merge/SKILL.md
│       │   ├── concerto-abandon/SKILL.md
│       │   └── concerto-daemon/SKILL.md
│       └── install.sh                    # symlink into ~/.claude/skills/
└── dashboard/                            # Next.js (separate from npm workspace, like fonte)
    ├── package.json
    ├── next.config.ts
    ├── tailwind.config.ts
    ├── tsconfig.json
    └── src/
        ├── app/
        │   ├── layout.tsx
        │   ├── page.tsx                  # project picker / auto-redirect
        │   ├── p/[project]/
        │   │   ├── page.tsx              # board view
        │   │   ├── c/[card]/page.tsx     # card detail
        │   │   └── settings/page.tsx     # stage config + project settings
        │   └── projects/page.tsx
        ├── components/
        │   ├── board/                    # column, card, drag-drop
        │   ├── card-detail/              # diff viewer, worktree status
        │   ├── chat/                     # from fonte chat-view + ui primitives
        │   └── ui/                       # shadcn-style primitives (copy from fonte)
        ├── hooks/                        # usePolling, useSSE (from fonte)
        └── lib/
            ├── api.ts                    # daemon HTTP client (slim, only what's needed)
            └── utils.ts
```

Tooling: TypeScript 5, Node ≥ 22 (or Bun — defer), Hono on `@hono/node-server`, better-sqlite3, Next.js 16 (App Router), Tailwind, shadcn primitives, `@dnd-kit/core` + `@dnd-kit/sortable` for drag-drop (deps already in fonte's dashboard — use the same versions for sanity).

---

## 3. SQLite schema

`~/.concerto/state.db`, WAL mode, busy_timeout=5000.

```sql
CREATE TABLE projects (
  id TEXT PRIMARY KEY,                    -- nanoid
  name TEXT NOT NULL,
  repo_path TEXT NOT NULL UNIQUE,         -- canonical absolute git-rev-parse --show-toplevel
  base_branch TEXT NOT NULL DEFAULT 'main',
  default_model TEXT,                     -- nullable; falls back to user CLAUDE config
  project_brief TEXT,                     -- 200-500 chars, injected into every card's system prompt
  settings_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL
);

CREATE TABLE stages (
  id TEXT PRIMARY KEY,                    -- nanoid
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,                     -- 'Backlog', 'Ready', ...
  position INTEGER NOT NULL,              -- column order
  kind TEXT NOT NULL,                     -- 'backlog' | 'active' | 'review' | 'done' | 'archive'
                                          -- 'review' = the human-only gate
                                          -- 'done' = work acknowledged-good, not yet merged
  created_at INTEGER NOT NULL,
  UNIQUE(project_id, name),
  UNIQUE(project_id, position)
);

-- transitions are derived: any stage can transition to any other stage of the same project,
-- but the controller enforces these extra rules:
--   * Backlog kind → only manual user transitions in
--   * Anything → Done requires kind='review' as the source AND human-only flag (no agent self-promote)
--   * Anything → Merged requires the merge endpoint (not a plain transition)
-- v1 can promote this to an explicit transitions table if users need finer control.

CREATE TABLE cards (
  id TEXT PRIMARY KEY,                    -- nanoid (used in branch names; short)
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  slug TEXT NOT NULL,                     -- kebab(title), trimmed to 40 chars
  title TEXT NOT NULL,
  description TEXT,                       -- markdown; may contain "Depends on: #ID" lines
  stage_id TEXT NOT NULL REFERENCES stages(id),
  branch_name TEXT,                       -- nullable until first In Progress entry
  worktree_path TEXT,                     -- nullable until first In Progress entry
  base_sha TEXT,                          -- sha the worktree was forked from
  model_override TEXT,                    -- nullable; uses project's default_model
  position INTEGER NOT NULL,              -- order within stage column
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  -- lifecycle timestamps (denormalized; from cyanluna pattern)
  started_at INTEGER,                     -- first transition into 'active' kind stage
  testing_at INTEGER,
  review_at INTEGER,
  done_at INTEGER,
  merged_at INTEGER,
  abandoned_at INTEGER
);
CREATE INDEX cards_project_stage ON cards(project_id, stage_id);

CREATE TABLE conversations (
  id TEXT PRIMARY KEY,
  card_id TEXT NOT NULL UNIQUE REFERENCES cards(id) ON DELETE CASCADE,
  system_prompt_hash TEXT NOT NULL,       -- invalidate-on-change for caching
  created_at INTEGER NOT NULL
);

CREATE TABLE messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  message_id TEXT NOT NULL UNIQUE,        -- client-supplied or generated; for dedup
  turn_id TEXT NOT NULL,                  -- groups assistant/tool messages of one turn
  role TEXT NOT NULL,                     -- 'user' | 'assistant' | 'tool_use' | 'tool_result' | 'system'
  content_text TEXT,                      -- for role in (user, assistant, system)
  content_json TEXT,                      -- for role in (tool_use, tool_result) — structured
  tool_name TEXT,                         -- for tool_use rows
  streaming_complete INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX messages_conv ON messages(conversation_id, id);

CREATE TABLE worktrees (
  id TEXT PRIMARY KEY,
  card_id TEXT NOT NULL UNIQUE REFERENCES cards(id) ON DELETE CASCADE,
  path TEXT NOT NULL,                     -- $GIT_COMMON_DIR/concerto-worktrees/<card-id>
  branch TEXT NOT NULL,                   -- concerto/<slug>-<short-id>
  base_branch TEXT NOT NULL,
  base_sha TEXT NOT NULL,
  state TEXT NOT NULL,                    -- 'active' | 'merged' | 'abandoned' | 'missing'
  last_seen_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  card_id TEXT REFERENCES cards(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,                     -- 'stage_change' | 'message' | 'commit_detected' | ...
  actor TEXT NOT NULL,                    -- 'user' | 'agent' | 'system'
  payload_json TEXT NOT NULL,             -- structured payload
  created_at INTEGER NOT NULL
);
CREATE INDEX events_card ON events(card_id, id);

CREATE TABLE _migrations (
  version INTEGER PRIMARY KEY,
  applied_at INTEGER NOT NULL
);
```

**Why these specific shapes:**
- `stages` table (not enum) → configurable from v1 per project (user's call). `kind` field lets the controller enforce special behavior (review gate, merge transition) without naming specific stage names.
- Lifecycle timestamps on `cards` → cheap dashboard rendering, no need to query events for "when did this enter testing".
- `messages.content_json` for tool_use/tool_result → keeps structure (cyanluna's lesson: don't flatten `[tool: name]`).
- `events` is the audit log; `messages` is the conversation. They overlap a little but the separation is worth it (events drive activity feed and reconciliation; messages drive chat UI).

---

## 4. HTTP API surface

All endpoints under `http://localhost:7419`. Bearer auth from `~/.concerto/daemon.json`. Most endpoints support `?fields=a,b,c` for response shaping (cyanluna pattern).

```
GET    /health                                      { ok, version, uptime_ms }

# Projects
POST   /projects                                    body: { name?, repo_path } → upserts by repo_path
GET    /projects                                    [{ id, name, repo_path, ... }]
GET    /projects/by-path?path=<canonical>           404 with { reason: "unbound", suggest_bind: { name } } if not found
GET    /projects/:id
PATCH  /projects/:id                                update brief, base_branch, default_model, settings

# Stages
GET    /projects/:id/stages
PUT    /projects/:id/stages                         replace all (reorder, rename, add, remove)

# Cards
GET    /projects/:id/cards?stage=<id>&fields=...
POST   /projects/:id/cards                          body: { title, description?, stage_id?, model_override? }
GET    /cards/:id?fields=...
PATCH  /cards/:id                                   metadata only (title, description, position)
DELETE /cards/:id                                   only valid in 'backlog' kind; otherwise must abandon

# Transitions
POST   /cards/:id/transitions                       body: { to_stage_id, actor: 'user'|'agent', reason? }
                                                    409 with { reason, allowed: [stage_id...] } on rejection
                                                    side effects: creates/cleans worktree, stamps timestamp

# Conversation
POST   /cards/:id/messages                          body: { content, client_message_id }
                                                    immediately persists user row; agent runs async
GET    /cards/:id/messages?since_id=<n>&limit=200   incremental polling fallback
GET    /cards/:id/stream                            SSE: token, tool_use, tool_result, stage_change, done
POST   /cards/:id/interrupt                         SIGTERM the in-flight subprocess; queued user msgs preserved

# Worktree
GET    /cards/:id/worktree                          { path, branch, base, ahead, behind, dirty_files, last_commit }
GET    /cards/:id/diff?against=base                 unified diff string (capped at e.g. 1 MB)

# Merge / Abandon
POST   /cards/:id/merge                             body: { strategy: 'squash'|'merge'|'rebase', commit_message }
                                                    runs git merge-tree precheck → if clean, merges, cleans up
                                                    409 with { reason: 'conflict', files: [...] } if conflict
POST   /cards/:id/abandon                           body: { stash_dirty: boolean }

# Global
GET    /events/stream                               SSE: all events across all projects (for board live updates)
```

**Composite "atomic" endpoints** (lesson from cyanluna's anti-pattern: don't force the skill to do 4 round-trips for one action):
- `POST /cards/:id/transitions` already handles worktree create/cleanup as a side effect of the transition.
- `POST /cards/:id/merge` does precheck + merge + cleanup + stage transition in one call.

---

## 5. State machine

**Default stages** (created when a new project is bound):

| name | position | kind |
|---|---|---|
| Backlog | 0 | backlog |
| Ready | 1 | ready |
| In Progress | 2 | active |
| Testing | 3 | active |
| Review | 4 | review |
| Done | 5 | done |
| Merged | 6 | archive |

(plus an implicit `Abandoned` sink, not a column in the DB — it's a card-level flag via `abandoned_at`.)

**Transition rules enforced by the controller:**
1. Any stage → any other stage of the same project is *technically* allowed, BUT:
2. Target kind = `done`: source kind MUST be `review` AND actor MUST be `'user'` (review gate is human-only)
3. Target kind = `archive`: only reachable via `POST /cards/:id/merge` (not via plain transition)
4. Source kind = `archive`: no transitions out (cards are immutable post-merge)
5. Source kind ∈ {`active`, `review`} and worktree exists: any transition that leaves these kinds must preserve the worktree (no auto-cleanup mid-flight)
6. Target kind = `active` and worktree doesn't exist: controller creates it as a side effect
7. Source kind = `active` → target kind = `ready` (i.e. "send back"): worktree preserved (resume later)
8. On 4xx rejection, response includes `{ allowed: [stage_id...] }` — the set of legal targets from current state. (Cyanluna pattern; lets agents self-correct.)

**Agent self-transition:**
- The MCP tool `concerto.set_status` calls this same endpoint with `actor: 'agent'`.
- Server rules ensure agents can move themselves up to `review` but never to `done`.
- Agents can move backward (e.g. testing → in_progress) freely — useful for "I realized this isn't ready" self-corrections.

---

## 6. MCP tools exposed to Claude per card

The daemon hosts an MCP server on a Unix socket (path written to the worktree's `.concerto/mcp.sock`). The per-card `claude` invocation includes a project-scoped `.mcp.json` that points to this socket and authenticates with a per-card token.

**Tools (minimal v0 set):**

```json
{
  "concerto.get_card": {
    "description": "Get this card's metadata, current stage, and recent activity.",
    "input_schema": {}
  },
  "concerto.set_status": {
    "description": "Move this card to a different stage. Use 'testing' when the work is ready for the user to verify; use 'review' when you're confident it's done. Cannot move to 'done' or 'merged'.",
    "input_schema": {
      "type": "object",
      "required": ["to_stage"],
      "properties": {
        "to_stage": { "type": "string", "description": "Stage name (e.g. 'Testing', 'Review')." },
        "reason": { "type": "string", "description": "One-line explanation of why you're moving the card." }
      }
    }
  },
  "concerto.add_note": {
    "description": "Append a note to this card's activity log. Use for status updates, decisions, or anything the user should see at a glance.",
    "input_schema": {
      "type": "object",
      "required": ["content"],
      "properties": { "content": { "type": "string" } }
    }
  },
  "concerto.list_stages": {
    "description": "List all stages for this card's project, in order, with their kinds. Use to find a valid target before calling set_status.",
    "input_schema": {}
  },
  "concerto.request_review": {
    "description": "Mark this card as ready for human review. Equivalent to set_status({to_stage: 'Review'}) but also pings the user via the dashboard.",
    "input_schema": {
      "type": "object",
      "properties": { "summary": { "type": "string", "description": "Short summary of what was done." } }
    }
  }
}
```

**System-prompt block** auto-injected into every card's Claude conversation (~80 lines max):
```
You are working on a Concerto card in a git worktree.

Card: <title>
Description: <description (truncated to 1k chars)>
Current stage: <stage_name>
Project brief: <project.project_brief or "(none set)">
Worktree: <path>
Base branch: <base_branch> @ <base_sha>

Tools available via the `concerto.*` MCP server:
- concerto.get_card: refresh your view of the card
- concerto.set_status: move the card forward when work is ready (cannot mark as done/merged)
- concerto.add_note: log progress notes the user will see in the dashboard
- concerto.list_stages: see available stages for this project
- concerto.request_review: ask the human for review

When you finish what the user asked, call concerto.request_review with a short summary.
Don't auto-commit — the user owns commits unless they explicitly ask you to commit.
```

---

## 7. Skill structure

Following cyanluna's shared-library-skill pattern. One root skill (`concerto`) owns the shared knowledge; verb sub-skills are thin and reference `../concerto/shared.md`.

### `packages/skill/SKILL.md` (root)
```yaml
---
name: concerto
description: "Kanban board for Claude Code conversations in this repo. Each card is a Claude conversation in its own git worktree. Use /concerto to open the board, /concerto new to create a card, /concerto start to begin work. For pipeline orchestration, use /concerto-* verb skills. Run the bind step on first use in a new repo."
license: MIT
---

> Shared context: this is the root of the concerto skill family. Read `shared.md` and `schema.md` before any operation.

# Concerto — kanban for Claude Code conversations

## Commands available
- `/concerto` — open the board for the current repo in the browser
- `/concerto new "<title>" [--description "..."]` — create a card in Backlog
- `/concerto list [--stage <name>]` — print board as text table
- `/concerto start <card-id>` — create worktree, spawn agent, begin conversation
- `/concerto say <card-id> "<message>"` — send a user message into an active card's conversation
- `/concerto merge <card-id>` — squash-merge worktree into base branch
- `/concerto abandon <card-id>` — clean up worktree (stashes dirty work)
- `/concerto daemon {status|start|stop|logs}` — daemon control

(Each command is implemented as its own sub-skill at `verbs/concerto-<verb>/`.)

## Operating principles
1. Always run `scripts/discover-daemon.mjs` first — auto-spawns daemon if down.
2. Always run `scripts/ensure-bound.mjs` next — binds the current repo to a project if unbound.
3. Honor the state machine response — on 409 with `allowed[]`, retry once with `allowed[0]`. On second failure, ask the user.
4. Never auto-commit on behalf of the agent. The user owns git.
5. Never reuse a card-id across projects.
```

### `packages/skill/shared.md`
```markdown
# Shared context for concerto skills

## Daemon discovery
1. Read `~/.concerto/daemon.json` for `{port, token, pid}`
2. Probe `GET http://localhost:<port>/health` with `Authorization: Bearer <token>`
3. If 200 → use it. If anything else → spawn `concerto daemon start --detach` and wait up to 3s.
4. If still down → tell the user `concerto daemon logs` for diagnostics. Stop.

## Project binding
1. Run `git rev-parse --show-toplevel` to get the canonical repo path.
2. `GET /projects/by-path?path=<canonical>`
3. If 200 → use the returned project id.
4. If 404 with `{ reason: "unbound" }` → ask user "Bind this repo to Concerto? [Y/n]". On yes, `POST /projects { name, repo_path }`.

## State machine
- Stages are per-project. Always call `GET /projects/:id/stages` to learn the legal targets.
- Transitions: `POST /cards/:id/transitions { to_stage_id, actor: 'user', reason }`
- On 409 with `{ allowed: [...] }`, retry exactly once with `allowed[0]`.
- The 'done' kind and the 'archive' kind are special:
    - 'done' is reachable only from 'review' kind, and only with `actor: 'user'` (human gate)
    - 'archive' is reachable only via `POST /cards/:id/merge` (not a normal transition)

## JSON safety
NEVER embed user text directly in shell. Always pipe through `jq -n --arg` or a Node script. This is non-negotiable — card titles with quotes/newlines have already eaten enough engineers in cyanluna's wake.

## Auth
Token from `~/.concerto/daemon.json` (chmod 600). Localhost-only. Bearer header.

## Error envelope
All errors: `{ error: { code, message, hint? } }` with HTTP status appropriate to the failure mode.
```

### Per-verb sub-skill example: `verbs/concerto-new/SKILL.md`
```yaml
---
name: concerto-new
description: "Create a new card in Backlog. Use when the user wants to capture an idea, task, or todo into the kanban board. Run /concerto-init first if this is the first command in an unbound repo."
license: MIT
---

> Shared context: read `../shared.md` and `../schema.md` first.

# /concerto new

Inputs (positional or interactive):
- `title` (required, ≤ 200 chars)
- `--description` (optional, markdown)
- `--ready` flag → create directly in 'Ready' kind stage instead of Backlog
- `--start` flag → create AND immediately /concerto start the card (combined call)

Steps:
1. Discover daemon (`scripts/discover-daemon.mjs`)
2. Ensure project bound (`scripts/ensure-bound.mjs`)
3. POST /projects/:id/cards { title, description? }
4. If --ready or --start: POST /cards/:id/transitions { to_stage_id: <ready or in_progress>, actor: 'user' }
5. If --start: also follow `/concerto start` flow
6. Print card id, slug, and dashboard URL.
```

### Installation (`packages/skill/install.sh`)
- Symlinks `packages/skill/` into `~/.claude/skills/concerto/`
- Symlinks each `packages/skill/verbs/concerto-<verb>/` into `~/.claude/skills/concerto-<verb>/`
- Idempotent

---

## 8. Worktree manager (`packages/core/src/worktree.ts`)

```ts
export interface WorktreeManager {
  create(opts: CreateWorktreeOpts): Promise<WorktreeRecord>;
  remove(cardId: string, opts: { stashDirty?: boolean }): Promise<void>;
  status(cardId: string): Promise<WorktreeStatus>;
  reconcile(): Promise<{ missing: string[]; cleaned: string[] }>;
  diff(cardId: string, against: 'base' | 'head'): Promise<string>;
}

export interface CreateWorktreeOpts {
  cardId: string;
  slug: string;
  repoPath: string;
  baseBranch: string;
}
```

**Implementation notes:**
- Worktree path: `<GIT_COMMON_DIR>/concerto-worktrees/<cardId>` where `GIT_COMMON_DIR` comes from `git -C <repo> rev-parse --git-common-dir`. Resolves correctly even when called from inside another worktree.
- Branch name: `concerto/<slug-truncated-to-40>-<cardId-last-6>`
- `create()` validates the branch doesn't exist; if it does (collision), suffix with `-2`, `-3`...
- `remove({ stashDirty: true })` runs `git stash create` then `git update-ref refs/concerto-abandoned/<cardId> <stash-sha>` so dirty work survives. Recoverable for 30 days via a periodic GC sweep that prunes refs older than that.
- `reconcile()` runs `git worktree list --porcelain` and cross-references with the DB; flags missing worktrees as `state='missing'` on the card, and prunes DB rows for worktrees gone from disk but expected.
- All git operations shell out to the system `git` (no libgit2 dependency).
- `.gitignore`-blind-spot avoidance: worktrees live in `$GIT_COMMON_DIR`, which is `.git/` or a worktree's `.git` file pointing back to common dir. They never appear in `git status` from any working tree.

---

## 9. Dashboard

**Design source of truth:** [design.md](./design.md). Sparse, one primary action per screen, bold weight before color, 8pt grid, Lucide-style outlined icons paired with labels, neutral palette with one accent. When designing a view, draft it, then cut twice.

### Routes
- `/` — auto-redirects to the only bound project, or shows project picker
- `/projects` — manage bound projects
- `/p/[project]` — **board view** (the home page for a project)
- `/p/[project]/c/[card]` — **card detail** (drawer or full page)
- `/p/[project]/c/[card]/diff` — full diff viewer
- `/p/[project]/settings` — stages editor (rename, reorder, add, remove), project brief, base branch, default model

### Board view
- Columns rendered from `GET /projects/:id/stages`
- Cards in each column from `GET /projects/:id/cards?stage=<id>&fields=id,title,position,last_activity_at,worktree.dirty_files`
- Drag-drop between columns → `POST /cards/:id/transitions`
- Live updates via `GET /events/stream` SSE (scoped to current project)
- Card visual cues:
  - Dirty worktree → small orange dot
  - Stale base (>N commits behind) → "rebase" badge
  - Mid-stream agent → animated dot
  - Merge conflict (post-merge attempt) → red dot

### Card detail
- Left panel: metadata (title, description editable inline), worktree info (branch, files-touched, last commit), action bar
- Right panel: conversation (lifted from fonte's `chat-view.tsx`, renamed `agentId` → `cardId`, structured tool-call rendering added)
- Composer at bottom: standard textarea with submit-on-Enter
- "Interrupt" button when agent is mid-turn
- "Send back to In Progress" button visible in Review stage
- "Approve → Done" button visible in Review (human-only gate)

### Stage editor (settings page)
- Drag-drop list of stages
- Each row: name, kind (dropdown: backlog/ready/active/review/done/archive), delete
- Validation: at minimum one of each: backlog, active, review, archive kinds must exist
- "Reset to defaults" button

---

## 10. Milestone plan

### M1 — Foundation (week 1)
- Initialize workspace: `packages/{core,daemon,skill}`, tsconfig, build wiring
- `core/db.ts` + migrations: projects, stages, cards tables only (skip conversations/messages/events/worktrees for now)
- `core/projects.ts` + `core/cards.ts` + `core/stages.ts`: CRUD, no transitions yet
- `daemon/server.ts` + `daemon/routes/{health,projects,cards}.ts`: HTTP wiring with Hono
- `daemon/cli.ts`: start/stop/status (copy from fonte/cli/daemon.ts; rename FONTE_HOME → CONCERTO_HOME, port 3777 → 7419)
- `skill/SKILL.md` + `skill/shared.md` + verbs: concerto-new, concerto-list, concerto-daemon
- `skill/scripts/discover-daemon.mjs` + `scripts/ensure-bound.mjs`
- **Acceptance:** in a fresh repo, `/concerto-new "test"` auto-spawns daemon, binds repo, creates card. `/concerto-list` shows it.

### M2 — Worktree + state machine (week 2)
- Add `worktrees` and `events` tables; migration 002
- `core/worktree.ts`: create, remove, reconcile, status, diff
- `core/controller.ts`: `CardController` with `transition(cardId, toStageId, actor)` enforcing rules
- `daemon/routes/cards.ts`: `POST /cards/:id/transitions` with `.allowed[]` on rejection
- `daemon/routes/worktree.ts`: status, diff
- New verb: `concerto-start`, `concerto-abandon`
- **Acceptance:** create card → start (worktree appears in `git worktree list`) → abandon (worktree gone, stash ref present).

### M3 — Claude conversation (week 3)
- Copy `fonte/packages/core/src/adapters/claude.ts` → `core/src/claude/driver.ts`; rename, generalize event shape to `ClaudeEvent` discriminated union (text/tool_use/tool_result/usage)
- Copy `fonte/packages/core/src/invoke.ts` lines 26-172 → `core/src/claude/subprocess.ts`; keep only `runCommand`, `runCommandStreaming`, `activeProcesses` map; replace global map with `AbortSignal`
- `core/src/conversations.ts`: persistence, agentChains Map per card (lifted from fonte/main:146-177), turn lifecycle
- `core/src/claude/prompt.ts`: 30-line system prompt builder
- Add `conversations` and `messages` tables; migration 003
- `daemon/routes/messages.ts`: POST send, GET history (since_id polling)
- `daemon/routes/stream.ts`: per-card SSE
- New verb: `concerto-say`
- **Acceptance:** `/concerto-say <id> "hello"` → assistant response streams; full transcript persists; killing daemon mid-turn → recovery on restart (mark `interrupted`).

### M4 — Dashboard (week 4)
- Initialize Next.js app in `dashboard/`
- Copy fonte's UI primitives (`components/ui/{chat-container,prompt-input,markdown,code-block}.tsx`)
- Copy `dashboard/src/lib/hooks.ts` (usePolling, useSSE, timeAgo)
- Build `dashboard/src/lib/api.ts` — thin client, only chat + card endpoints
- Board page: columns from stages, cards in each column, drag-drop wired to transitions API
- Card detail drawer: chat view + worktree info + action bar
- Stage editor page
- **Acceptance:** full board UX — drag a card between columns, click into detail, send a message, see streaming response, see diff.

### M5 — Merge flow + MCP tools (week 5)
- `daemon/routes/merge.ts`: precheck via `git merge-tree`, perform squash merge, cleanup worktree, stage to archive
- `core/src/mcp/server.ts`: Unix socket MCP server scoped per card
- `core/src/mcp/tools.ts`: `concerto.set_status`, `concerto.add_note`, `concerto.list_stages`, `concerto.get_card`, `concerto.request_review`
- Auto-generate `.mcp.json` in worktree on Start
- Update Claude system prompt to mention the tools
- New verb: `concerto-merge`
- **Acceptance:** agent calls `concerto.request_review` mid-conversation → card moves to Review automatically. Human clicks Approve → Done. `/concerto-merge` squashes into main, cleans worktree.

### M6 — Polish + edge cases (week 6)
- Stage editor UI in dashboard (M4 had API; this adds the editor)
- Per-card lifecycle timestamps surfacing (badges, "started X ago", etc.)
- Project brief field + injection into system prompt
- Periodic reconciliation (`worktree.reconcile()` every 30s, flag missing worktrees on cards)
- 30-day GC sweep for abandoned-work stash refs
- README, install script, demo gif
- **Acceptance:** end-to-end demo: clone a fresh repo, install skill, run through 3 cards in parallel, merge them, abandon one (verify stash recoverable), explore the dashboard at length.

---

## 11. Fonte reuse inventory (file-by-file)

| Source (in fonte) | Destination (in concerto) | Treatment |
|---|---|---|
| `packages/core/src/adapters/claude.ts` | `packages/core/src/claude/driver.ts` | Copy + generalize events to discriminated union |
| `packages/core/src/adapters/types.ts` | `packages/core/src/claude/types.ts` | Copy verbatim |
| `packages/core/src/invoke.ts` (L26-172) | `packages/core/src/claude/subprocess.ts` | Copy `runCommand`, `runCommandStreaming`, replace global `activeProcesses` with `AbortSignal` |
| `packages/main/src/index.ts` (L146-177) | `packages/core/src/conversations.ts` | Lift `agentChains` Map; rename agent → card |
| `packages/core/src/logging.ts` | `packages/core/src/events.ts` | Copy `emitEvent`/`onEvent` only; drop file logging unless needed |
| `packages/core/src/queues.ts` (L1-50, WAL setup) | `packages/core/src/db.ts` | Copy WAL/busy_timeout/migration pattern; rewrite schema |
| `packages/server/src/sse.ts` | `packages/daemon/src/sse.ts` | Copy verbatim |
| `packages/server/src/index.ts` | `packages/daemon/src/server.ts` | Copy skeleton; strip Fonte-specific route mounts |
| `packages/cli/src/daemon.ts` | `packages/daemon/src/cli.ts` | Copy; rename FONTE_HOME → CONCERTO_HOME, port 3777 → 7419 |
| `dashboard/src/components/agent/chat-view.tsx` | `dashboard/src/components/chat/chat-view.tsx` | Copy; rename agentId → cardId; drop @agent routing; render structured tool calls instead of flattened |
| `dashboard/src/components/ui/chat-container.tsx` | `dashboard/src/components/ui/chat-container.tsx` | Copy verbatim |
| `dashboard/src/components/ui/prompt-input.tsx` | `dashboard/src/components/ui/prompt-input.tsx` | Copy verbatim |
| `dashboard/src/components/ui/markdown.tsx` | `dashboard/src/components/ui/markdown.tsx` | Copy verbatim |
| `dashboard/src/components/ui/code-block.tsx` | `dashboard/src/components/ui/code-block.tsx` | Copy verbatim |
| `dashboard/src/lib/hooks.ts` | `dashboard/src/lib/hooks.ts` | Copy verbatim |
| `dashboard/src/lib/api.ts` (chat+SSE slice only) | `dashboard/src/lib/api.ts` | Copy `apiFetch`, `getApiBase`/`setApiBase`, `checkConnection`, `subscribeToEvents`; drop everything else |
| `.githooks/commit-msg` | `.githooks/commit-msg` | Copy verbatim (AI attribution block) |
| `tsconfig.base.json`, root `package.json` workspace shape | same | Adapt |

**Explicitly NOT reused** (refactorer's call, agreed):
- `packages/core/src/agent.ts` — Fonte's system prompt builder is too coupled to torrents/teammates/SOUL
- All other adapters (`codex.ts`, `gemini.ts`, `opencode.ts`) — Claude-only for v0
- `packages/core/src/{router,plugins,schedules,memory}.ts`
- `packages/server/src/routes/{torrents,watchlist,subtitles,whatsapp,automations,messages with channel routing}.ts`
- `dashboard/src/components/chat-panel.tsx` (the drawer chat — pick one chat surface)
- `responses` outbox table (no outbound channels)

---

## 12. Borrow list from cyanluna.skills (none of their code, all of their patterns)

These appear in the plan above but listed here for traceability:

| Pattern | Where it lives in v0 |
|---|---|
| Shared-library-skill | `packages/skill/SKILL.md` + `shared.md` + `schema.md` (root) referenced by verb sub-skills |
| Server-enforced transitions w/ `.allowed[]` on 409 | `core/controller.ts` + `daemon/routes/cards.ts` |
| `project_brief` injected into every system prompt | `projects.project_brief` column + `claude/prompt.ts` |
| Plan-then-execute for multi-card commands | Deferred (v1 — needed when `/concerto-batch` lands) |
| Anchor task pattern | Deferred to v1 (`/concerto seed`) |
| Lifecycle timestamp columns | `cards.{started_at, testing_at, review_at, done_at, merged_at}` |
| `?fields=` query param + per-verb field minimisation | All GET endpoints supporting `fields` param |
| `Depends on: #N` convention | Schema-ready (description text), parsing deferred to v1 |
| Auth split: `~/.concerto/daemon.json` (secrets) vs `.concerto/project.json` (in-repo, deferred) | Daemon-side only in v0; per-repo file added when bind metadata grows |
| Signature header on agent-written notes | `concerto.add_note` server-side prepends `> **agent** \`<model>\` · <iso-ts>` |
| Pre-flight health probe before expensive operation | `discover-daemon.mjs` runs on every skill invocation |
| Resist agent zoo | One card = one conversation. No internal pipeline. |

---

## 13. Open risks and validation points

1. **Claude CLI version pin.** Stream-json event shape changes between Claude Code releases. Pin a known-good version (current latest) and version-check on daemon startup. Refuse to start with `< pinned` and warn on `> pinned`.

2. **MCP-over-Unix-socket per card.** Untested combination. Fallback: stdio MCP via a wrapper script the daemon spawns alongside `claude`. Validate during M5; switch to fallback if socket discovery is flaky.

3. **`git worktree` with submodules.** Submodules behave oddly with worktrees in older git versions. Document minimum git version (>= 2.43 recommended) and verify on daemon startup.

4. **Worktree creation latency on large repos.** `git worktree add` can be slow on multi-GB repos with hundreds of files. Measure on M2; if > 5s, surface in UI as a progress indicator. v1 may add shallow/sparse worktree options.

5. **Conversation context growth.** Long cards balloon. v0 surfaces per-card token usage from `usage` events; v1 adds a "compact this card" button.

6. **`.env` / `node_modules` across worktrees.** Worktrees share `.git` but not the working tree. Document loudly that secrets/local config don't follow. v1 adds an opt-in "files to symlink from main" list.

7. **Concurrent skill invocations.** Two terminals running `/concerto-start <same-id>` simultaneously could race. Idempotent worktree creation handles the git side; `cards.stage_id` updates use SQLite's row locking.

8. **Auto-spawn race.** Two skill invocations simultaneously detecting "daemon down" both try to spawn. PID-file based single-instance check + a short retry loop on the second instance.

9. **MCP tool authorization.** Agent could theoretically call `concerto.set_status` for a different card if it discovers the card-id. Per-card MCP token + server-side check that the calling token matches the card id.

10. **Squash-merge default vs user preference.** Some teams want merge commits. v0 hardcodes squash; v1 surfaces as per-project setting.

---

## 14. Deliverables checklist

By end of M6:
- [ ] `concerto/` repo with full workspace setup
- [ ] `npm run dev` brings up daemon + dashboard
- [ ] `npm run build` produces a publishable artifact
- [ ] `packages/skill/install.sh` installs the skill into `~/.claude/skills/`
- [ ] `concerto daemon start` works as a standalone command
- [ ] README walks through: install → bind a repo → create + start a card → see streaming response → request review → approve → merge
- [ ] Demo gif of the end-to-end flow
- [ ] AGENTS.md describes the API for the per-card Claude (mirrors fonte's pattern)
- [ ] CLAUDE.md describes the repo's conventions for Claude Code working ON concerto itself
- [ ] commit-msg hook installed (block AI attribution)

---

## 15. Out-of-band questions still worth deciding

- **Auto-merge policy:** off by default; once we have data on conflict rates, consider opt-in "auto-merge if zero conflicts".
- **PR creation on Done:** TBD per user — could add `gh pr create` integration as opt-in v1 flag.
- **`npm` name conflict:** publish as `@concerto-app/*` scope, or rename. Decide before public release.
- **Telemetry:** none in v0. Worth considering anonymous usage stats in v1 for tuning (e.g. average cards per project, % cards that finish, etc.) — opt-in only.
- **Multi-project view:** v0 shows one project at a time. v1 could show a "global inbox" across all bound projects (useful for someone juggling 5+ repos).
