---
name: coro-daemon
description: "Control the coro daemon: start, stop, check status, view logs. Use when the user wants to manually start, stop, or troubleshoot the local coro daemon. Most other coro verbs auto-spawn the daemon, so you only need this for diagnostics."
license: MIT
---

> Shared context: read `../coro/shared.md` first.

# /coro-daemon

Subcommands:

- `/coro-daemon start` — start the daemon (no-op if already running)
- `/coro-daemon stop` — stop the daemon
- `/coro-daemon status` — show pid, port, uptime
- `/coro-daemon logs` — tail the daemon log

Implementation: shell out to `coro daemon <sub>`. If `coro` is not on PATH, point the user at the install instructions.

After any `start`/`stop`, read `~/.coro/daemon.json` to confirm the new state and report it back briefly:

- `start` success: "coro daemon running (port N)"
- `stop` success: "coro daemon stopped"
- failure: print the relevant log tail and stop. Do not retry.
