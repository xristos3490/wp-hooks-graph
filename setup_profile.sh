#!/usr/bin/env bash
# Adds the hooksgraph() shell function to ~/.zshrc

set -euo pipefail

MARKER="# --- WordPress Hooks Graph ---"
ZSHRC="$HOME/.zshrc"
HG_DIR="$(cd "$(dirname "$0")" && pwd)"

BLOCK=$(cat <<EOF
$MARKER
hooksgraph() {
  "$HG_DIR/venv/bin/python3" "$HG_DIR/hooks_graph.py" "\$@" --serve
}
# --- /WordPress Hooks Graph ---
EOF
)

# Already installed?
if [ -f "$ZSHRC" ] && grep -qF "$MARKER" "$ZSHRC"; then
  echo "✓ hooksgraph() already exists in $ZSHRC — nothing to do."
  exit 0
fi

echo "This will append the following to $ZSHRC:"
echo ""
echo "$BLOCK"
echo ""
printf "Proceed? [y/N] "
read -r answer
if [[ ! "$answer" =~ ^[Yy]$ ]]; then
  echo "Aborted."
  exit 1
fi

echo "" >> "$ZSHRC"
echo "$BLOCK" >> "$ZSHRC"
echo ""
echo "✓ Added hooksgraph() to $ZSHRC"
echo ""
echo "Run this to activate now (npm can't source your parent shell):"
echo ""
echo "  source ~/.zshrc"
echo ""
echo "Usage:  hooksgraph /path/to/wordpress-repo"
