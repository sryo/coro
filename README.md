# Concerto

A Kanban board for Claude Code conversations.

Each card is a conversation with Claude Code, running in its own git worktree. Multiple cards = multiple agents working in parallel without stepping on each other. Distributed as a Claude Code skill + local companion daemon + Next.js dashboard.

**Status:** pre-alpha. See [PLAN.md](./PLAN.md) for the design doc.

## Install (planned)

```sh
npm install -g concerto
concerto daemon start    # or just let the skill auto-spawn it
```

Then install the skill into Claude Code:

```sh
cd $(npm root -g)/concerto/packages/skill
./install.sh
```

In any repo:

```
/concerto new "fix the login redirect"
/concerto start <card-id>
```

The dashboard opens at http://localhost:7420.
