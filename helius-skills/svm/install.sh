#!/usr/bin/env bash
set -euo pipefail

SKILL_NAME="svm"
SKILL_DIR="$(cd "$(dirname "$0")" && pwd)"

# Default: install to personal skills
TARGET_BASE="$HOME/.claude/skills"
MODE="personal"

usage() {
  echo "Usage: ./install.sh [OPTIONS]"
  echo ""
  echo "Install the SVM skill for Claude Code."
  echo ""
  echo "Options:"
  echo "  --project     Install to current project (.claude/skills/) instead of personal"
  echo "  --path PATH   Install to a custom path"
  echo "  --help        Show this help message"
  echo ""
  echo "Examples:"
  echo "  ./install.sh              # Install to ~/.claude/skills/svm/"
  echo "  ./install.sh --project    # Install to ./.claude/skills/svm/"
  echo "  ./install.sh --path /tmp  # Install to /tmp/svm/"
}

while [[ $# -gt 0 ]]; do
  case $1 in
    --project)
      TARGET_BASE=".claude/skills"
      MODE="project"
      shift
      ;;
    --path)
      TARGET_BASE="$2"
      MODE="custom"
      shift 2
      ;;
    --help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1"
      usage
      exit 1
      ;;
  esac
done

TARGET="$TARGET_BASE/$SKILL_NAME"

# Verify source exists
if [ ! -f "$SKILL_DIR/SKILL.md" ]; then
  echo "Error: SKILL.md not found in $SKILL_DIR"
  echo "Make sure you're running this from the skill directory."
  exit 1
fi

# Create target directory
mkdir -p "$TARGET"

# Copy skill files
cp -r "$SKILL_DIR/SKILL.md" "$TARGET/"
cp -r "$SKILL_DIR/references" "$TARGET/" 2>/dev/null || true

echo "SVM skill installed to $TARGET ($MODE)"
echo ""
echo "Next steps:"
echo "  1. Install the Helius MCP server (if not already):"
echo "     claude mcp add helius npx helius-mcp@latest"
echo ""
echo "  2. No API key required — all tools fetch from public sources."
echo ""
echo "  3. Start exploring! Try prompts like:"
echo "     'How does Proof of History work?'"
echo "     'Explain Sealevel parallel execution and local fee markets'"
echo "     'Walk me through how a Rust program becomes deployed bytecode on Solana'"
echo "     'What is Alpenglow and how does it improve on Tower BFT?'"
