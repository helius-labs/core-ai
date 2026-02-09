# Helius CLI

Official command-line interface for [Helius](https://helius.dev) - the leading Solana RPC and API provider. **Designed for LLM agents and automation.**

## Quick Start for Agents

```bash
# 1. Generate a keypair
helius keygen

# 2. Fund the wallet (shown in keygen output)
#    - ~0.001 SOL for transaction fees
#    - 1 USDC for signup

# 3. Create account + project
helius signup

# 4. Get your API keys
helius projects
helius apikeys <project-id>
```

## Installation

```bash
# Install globally via npm
npm install -g helius-cli

# Or with pnpm
pnpm add -g helius-cli
```

## Commands

| Command | Description |
|---------|-------------|
| `helius keygen` | Generate a new Solana keypair |
| `helius signup` | Pay 1 USDC + create account + project |
| `helius login` | Authenticate with existing wallet |
| `helius projects` | List all projects |
| `helius project [id]` | Get project details |
| `helius apikeys [project-id]` | List API keys |
| `helius apikeys create [project-id]` | Create new API key |
| `helius usage [project-id]` | Show credits usage |
| `helius rpc [project-id]` | Show RPC endpoints |

## Keypair Management

### Generate Keypair

```bash
helius keygen
```

Output:
```
✓ Keypair generated
Path: /home/user/.helius-cli/keypair.json
Address: 7xKp...3nQm

To use this wallet, fund it with:
  • ~0.001 SOL for transaction fees
  • 1 USDC for Helius signup
```

### Default Keypair Path

All commands use `~/.helius-cli/keypair.json` by default. Override with `-k`:

```bash
helius login -k /path/to/other/keypair.json
```

### Keypair Not Found

If keypair doesn't exist, commands exit with clear instructions:

```
Error: Keypair not found at /home/user/.helius-cli/keypair.json
Run `helius keygen` to generate a keypair first.
```

## Signup Flow

### Requirements

| Asset | Amount | Purpose |
|-------|--------|---------|
| SOL | ~0.001 | Transaction fees + rent |
| USDC | 1.00 | Helius signup payment |

### Process

```bash
helius signup
```

1. Checks SOL balance (min 0.001 SOL)
2. Checks USDC balance (min 1 USDC)
3. Sends 1 USDC payment to Helius treasury
4. Creates account and project
5. Returns project ID and API key

### Insufficient Balance Errors

```
✖ Insufficient SOL for transaction fees
Have: 0.000000 SOL
Need: ~0.001 SOL

Send SOL to: 7xKp...3nQm
```

```
✖ Insufficient USDC
Have: 0.00 USDC
Need: 1 USDC

Send USDC to: 7xKp...3nQm
```

## JSON Output Mode

Add `--json` flag for machine-readable output:

```bash
helius projects --json
helius apikeys <project-id> --json
helius rpc <project-id> --json
```

Example output:
```json
{
  "projects": [
    {
      "id": "67b9d260-726b-4ba3-8bb0-dbbf794641bf",
      "name": "My Project",
      "plan": "free"
    }
  ]
}
```

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | General error |
| 10 | Not logged in |
| 11 | Keypair not found |
| 20 | Insufficient SOL |
| 21 | Insufficient USDC |
| 30 | No projects found |
| 31 | Project not found |
| 40 | API error |

## Configuration

Config stored in `~/.helius-cli/`:

```
~/.helius-cli/
├── config.json    # JWT authentication token
└── keypair.json   # Solana keypair (if generated with keygen)
```

## Example: Full Agent Workflow

```bash
# Step 1: Check if keypair exists
helius login
# If "Keypair not found" error:

# Step 2: Generate keypair
helius keygen
# Note the wallet address from output

# Step 3: Fund wallet externally
# Send 0.001 SOL + 1 USDC to the address

# Step 4: Create account
helius signup
# Returns project ID

# Step 5: Get API keys
helius projects
# Shows: Run `helius apikeys <project-id>` to view API keys

helius apikeys 67b9d260-726b-4ba3-8bb0-dbbf794641bf
# Returns API key

# Step 6: Get RPC endpoints
helius rpc 67b9d260-726b-4ba3-8bb0-dbbf794641bf
# Returns mainnet and devnet RPC URLs
```

## Development

```bash
# Clone and install
git clone https://github.com/helius-labs/helius-cli
cd helius-cli
pnpm install

# Run in development
pnpm dev keygen
pnpm dev signup
pnpm dev projects

# Build
pnpm build
```

## License

MIT
