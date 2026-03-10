#!/usr/bin/env bash
set -euo pipefail

SKILL_NAME="helius-jupiter"
SKILL_DIR="$(cd "$(dirname "$0")" && pwd)"

# Default: install to personal skills
TARGET_BASE="$HOME/.claude/skills"
MODE="personal"

usage() {
  echo "Usage: ./install.sh [OPTIONS]"
  echo ""
  echo "Install the Helius x Jupiter DeFi skill for Claude Code."
  echo ""
  echo "Options:"
  echo "  --project     Install to current project (.claude/skills/) instead of personal"
  echo "  --path PATH   Install to a custom path"
  echo "  --help        Show this help message"
  echo ""
  echo "Examples:"
  echo "  ./install.sh              # Install to ~/.claude/skills/helius-jupiter/"
  echo "  ./install.sh --project    # Install to ./.claude/skills/helius-jupiter/"
  echo "  ./install.sh --path /tmp  # Install to /tmp/helius-jupiter/"
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

echo "Helius x Jupiter DeFi skill installed to $TARGET ($MODE)"
echo ""
echo "Next steps:"
echo "  1. Install the Helius MCP server (if not already):"
echo "     claude mcp add helius npx helius-mcp@latest"
echo ""
echo "  2. Set your API keys (if not already):"
echo "     export HELIUS_API_KEY=your-helius-api-key"
echo "     Or use the setHeliusApiKey MCP tool in Claude Code"
echo ""
echo "     For Jupiter API access, get a key at:"
echo "     https://portal.jup.ag/"
echo ""
echo "  3. Start building! Try prompts like:"
echo "     'Swap 1 SOL for USDC using Jupiter with Helius Sender'"
echo "     'Build a lending dashboard with Jupiter Lend'"
echo "     'Set up a DCA to buy SOL weekly with 100 USDC'"
echo "     'Build a trading bot with LaserStream and Jupiter'"
