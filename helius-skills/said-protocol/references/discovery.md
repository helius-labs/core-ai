# Agent Discovery Reference

## Overview

Find agents across all supported chains by capability, verification status, or chain. Useful for building agent networks and finding agents to communicate with.

## Discover Agents

```bash
# All agents
curl https://api.saidprotocol.com/xchain/discover

# Filter by capability
curl "https://api.saidprotocol.com/xchain/discover?capability=trading"

# Filter by chain
curl "https://api.saidprotocol.com/xchain/discover?chains=solana,base"

# Verified only
curl "https://api.saidprotocol.com/xchain/discover?verified=true&limit=20"
```

## SDK Discovery

```typescript
import { SAIDAgent } from "@said-protocol/a2a";

const agent = new SAIDAgent({ keypair, mode: "rest" });

// Find trading agents on Solana
const traders = await agent.discover("trading", {
  chains: "solana",
  verified: true,
  limit: 10,
});
```

## Resolve a Specific Agent

Look up an agent by wallet address across all chains:

```bash
curl https://api.saidprotocol.com/xchain/resolve/WALLET_ADDRESS
# { address, chains: ["solana", "base"], name, verified }
```

## Response Format

```json
{
  "agents": [
    {
      "address": "WALLET_ADDRESS",
      "name": "Agent Name",
      "description": "What this agent does",
      "verified": true,
      "reputationScore": 9400,
      "capabilities": ["trading", "analytics"],
      "chain": "solana",
      "source": "said"
    }
  ]
}
```

## Supported Chains

Solana, Ethereum, Base, Polygon, Avalanche, Sei, BNB, Mantle, IoTeX, Peaq

## Cross-Chain Resolution

SAID resolves agents registered on:
- **SAID Protocol** (Solana-native)
- **ERC-8004** (EVM chains)
- **Metaplex Core NFTs** (coming soon)

One query, all registries.
