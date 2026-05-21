---
name: concerto-list
description: "Print the concerto board for this repo as a text table — one section per stage, cards within. Use when the user wants a quick snapshot of the kanban without opening the dashboard. Auto-spawns the daemon and binds the repo on first use."
license: MIT
---

> Shared context: read `../concerto/shared.md` first.

# /concerto-list

Optional inputs:
- `--stage <name>` — show only cards in this stage

Steps:

1. Resolve project via `ensure-bound.mjs`. On unbound, ask once; on no, stop.
2. `GET /projects/<id>/stages` and `GET /projects/<id>/cards` (in parallel).
3. Group cards by `stage_id`. Render in stage `position` order.
4. Output format — sparse, left-aligned, no decoration:

```
Backlog        (2)
  abc1234567  fix the login redirect
  def8901234  add dark mode toggle

In Progress    (1)
  ghi5678901  refactor the queue processor

Review         (0)
Done           (0)
```

Show only stages that have cards OR are an `active` / `review` / `done` kind (so the user sees the gates even when empty). Stages with no cards collapse to one line with `(0)`. Truncate titles to fit a reasonable terminal width.

If `--stage` is given, show only that stage's section (full list, no truncation of count).
