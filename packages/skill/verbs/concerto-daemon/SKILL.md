---
name: concerto-daemon
description: "Control the concerto daemon: start, stop, check status, view logs. Use when the user wants to manually start, stop, or troubleshoot the local concerto daemon. Most other concerto verbs auto-spawn the daemon, so you only need this for diagnostics."
license: MIT
---

> Shared context: read `../concerto/shared.md` first.

# /concerto-daemon

Subcommands:

- `/concerto-daemon start` — start the daemon (no-op if already running)
- `/concerto-daemon stop` — stop the daemon
- `/concerto-daemon status` — show pid, port, uptime
- `/concerto-daemon logs` — tail the daemon log

Implementation: shell out to `concerto daemon <sub>`. If `concerto` is not on PATH, point the user at the install instructions.

After any `start`/`stop`, read `~/.concerto/daemon.json` to confirm the new state and report it back briefly:

- `start` success: "concerto daemon running (port N)"
- `stop` success: "concerto daemon stopped"
- failure: print the relevant log tail and stop. Do not retry.
