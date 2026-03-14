#!/bin/bash
# Install SAID Protocol skill for Claude Code
# Usage: ./install.sh [--project] [--path /custom/path]

set -e

SKILL_DIR="$(cd "$(dirname "$0")" && pwd)"
TARGET=""

case "${1:-}" in
  --project)
    TARGET=".claude/skills/said-protocol"
    ;;
  --path)
    TARGET="$2/said-protocol"
    ;;
  *)
    TARGET="$HOME/.claude/skills/said-protocol"
    ;;
esac

echo "Installing SAID Protocol skill to: $TARGET"

mkdir -p "$TARGET/references"
mkdir -p "$TARGET/prompts"

cp "$SKILL_DIR/SKILL.md" "$TARGET/SKILL.md"
cp "$SKILL_DIR/references/"*.md "$TARGET/references/"
cp "$SKILL_DIR/prompts/"*.md "$TARGET/prompts/"

echo "✅ SAID Protocol skill installed"
echo ""
echo "Available in Claude Code as: /said-protocol"
echo ""
echo "Packages to install:"
echo "  npm install @said-protocol/a2a        # Agent messaging"
echo "  npm install @said-protocol/agent      # Identity & verification"
echo "  npm install @said-protocol/client     # Cross-chain client"
