#!/bin/sh
# Symlink coro skills into ~/.claude/skills/
# Idempotent — safe to re-run.

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SKILLS_DIR="${HOME}/.claude/skills"

mkdir -p "$SKILLS_DIR"

link() {
    local src="$1"
    local name="$2"
    local dest="$SKILLS_DIR/$name"
    if [ -L "$dest" ] || [ -e "$dest" ]; then
        rm -rf "$dest"
    fi
    ln -s "$src" "$dest"
    echo "  linked $name → $src"
}

echo "installing coro skills into $SKILLS_DIR"

# Root skill (holds shared.md + schema.md)
link "$SCRIPT_DIR" "coro"

# Verb sub-skills
for verb in "$SCRIPT_DIR"/verbs/*/; do
    [ -d "$verb" ] || continue
    name="$(basename "$verb")"
    link "$verb" "$name"
done

echo "done"
echo
echo "next: in any git repo, run /coro-daemon status"
