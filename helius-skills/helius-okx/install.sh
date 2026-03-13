#!/usr/bin/env bash
set -euo pipefail

SKILL_NAME="helius-okx"
SKILL_DIR="$(cd "$(dirname "$0")" && pwd)"

# Default: install to personal skills
TARGET_BASE="$HOME/.claude/skills"
MODE="personal"

usage() {
  echo "Usage: ./install.sh [OPTIONS]"
  echo ""
  echo "Install the Helius x OKX trading & intelligence skill for Claude Code."
  echo ""
  echo "Options:"
  echo "  --project     Install to current project (.claude/skills/) instead of personal"
  echo "  --path PATH   Install to a custom path"
  echo "  --help        Show this help message"
  echo ""
  echo "Examples:"
  echo "  ./install.sh              # Install to ~/.claude/skills/helius-okx/"
  echo "  ./install.sh --project    # Install to ./.claude/skills/helius-okx/"
  echo "  ./install.sh --path /tmp  # Install to /tmp/helius-okx/"
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

echo "Helius x OKX trading & intelligence skill installed to $TARGET ($MODE)"
echo ""
echo "Next steps:"
echo "  1. Install the Helius MCP server (if not already):"
echo "     claude mcp add helius npx helius-mcp@latest"
echo ""
echo "  2. Install the OKX onchainos CLI (if not already):"
echo "     curl -fsSL https://raw.githubusercontent.com/okx/onchainos-skills/main/install.sh | bash"
echo ""
echo "  3. Set your API keys (if not already):"
echo "     export HELIUS_API_KEY=your-helius-api-key"
echo "     Or use the setHeliusApiKey MCP tool in Claude Code"
echo ""
echo "     For OKX production use, set your credentials:"
echo "     export OKX_API_KEY=your-api-key"
echo "     export OKX_SECRET_KEY=your-secret-key"
echo "     export OKX_PASSPHRASE=your-passphrase"
echo ""
echo "  4. Start building! Try prompts like:"
echo "     'Swap 1 SOL for USDC using OKX aggregator with Helius Sender'"
echo "     'Find trending tokens on Solana and analyze their risk'"
echo "     'Track smart money signals and build a copy-trading bot'"
echo "     'Build a meme token scanner with rug pull detection'"
