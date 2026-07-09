#!/usr/bin/env bash
# scripts/self-improve.sh
# Post-commit hook that triggers a lightweight self-improvement scan.
# Logs findings to .obelisk/learnings/ for the next improvement cycle.
#
# Called by .husky/post-commit when available.
# Disabled by default — enable with: obelisk self-improve enable

set -euo pipefail

LEARNINGS_DIR=".obelisk/learnings"
mkdir -p "$LEARNINGS_DIR"

# Only run if enabled
if [ ! -f "$LEARNINGS_DIR/.enabled" ]; then
  exit 0
fi

# Lightweight scan: count TODOs, lint warnings, etc.
TODO_COUNT=$(rg -c "TODO|FIXME|HACK" --type-add 'code:*.{ts,tsx,js,jsx,rs,go,py}' -t code 2>/dev/null | wc -l || echo 0)

# Record learning
cat >> "$LEARNINGS_DIR/learnings.jsonl" << EOF
{"id":"hook-$(date +%s)","type":"post-commit-scan","content":"Scanned after commit: ${TODO_COUNT} tech debt markers","context":"","tags":["scan","post-commit"],"source":"self-improve","timestamp":"$(date -Iseconds)"}
EOF

# If more than 50 TODOs, suggest a full improvement cycle
if [ "$TODO_COUNT" -gt 50 ]; then
  echo "ℹ  ${TODO_COUNT} tech debt markers found. Run 'obelisk self-improve scan' for details."
fi