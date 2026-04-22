#!/usr/bin/env bash
# Adds a `hooksgraph` alias to the current user's shell startup file.
# Supports zsh, bash, and fish; falls back to printing manual instructions.

set -euo pipefail

MARKER="# --- WordPress Hooks Graph ---"
END_MARKER="# --- /WordPress Hooks Graph ---"
HG_DIR="$(cd "$(dirname "$0")" && pwd)"
SHELL_NAME=$(basename "${SHELL:-}")

case "$SHELL_NAME" in
  zsh)
    RC_FILE="$HOME/.zshrc"
    ALIAS_LINE="alias hooksgraph='$HG_DIR/../packages/cli/bin/hooksgraph.js'"
    ;;
  bash)
    if [ -f "$HOME/.bash_profile" ]; then
      RC_FILE="$HOME/.bash_profile"
    else
      RC_FILE="$HOME/.bashrc"
    fi
    ALIAS_LINE="alias hooksgraph='$HG_DIR/../packages/cli/bin/hooksgraph.js'"
    ;;
  fish)
    RC_FILE="$HOME/.config/fish/config.fish"
    mkdir -p "$(dirname "$RC_FILE")"
    ALIAS_LINE="alias hooksgraph '$HG_DIR/../packages/cli/bin/hooksgraph.js'"
    ;;
  *)
    echo "Couldn't detect a supported shell (\$SHELL=${SHELL:-<unset>})."
    echo "Supported: zsh, bash, fish."
    echo ""
    echo "Add this to your shell startup file manually:"
    echo "  alias hooksgraph='$HG_DIR/../packages/cli/bin/hooksgraph.js'"
    exit 1
    ;;
esac

BLOCK=$(cat <<EOF
$MARKER
$ALIAS_LINE
$END_MARKER
EOF
)

if [ -f "$RC_FILE" ] && grep -qF "$MARKER" "$RC_FILE"; then
  echo "✓ hooksgraph alias already present in $RC_FILE — nothing to do."
  exit 0
fi

echo "Shell detected: $SHELL_NAME"
echo "This will append to $RC_FILE:"
echo ""
echo "$BLOCK"
echo ""
printf "Proceed? [y/N] "
read -r answer
if [[ ! "$answer" =~ ^[Yy]$ ]]; then
  echo "Aborted."
  exit 1
fi

echo "" >> "$RC_FILE"
echo "$BLOCK" >> "$RC_FILE"
echo ""
echo "✓ Added hooksgraph alias to $RC_FILE"
echo ""
echo "Reload your shell to activate:"
echo ""
echo "  source $RC_FILE"
echo ""
echo "Usage:  hooksgraph /path/to/wordpress-repo"
