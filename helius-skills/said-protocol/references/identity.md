# Agent Identity Reference

## Overview

SAID provides persistent, verifiable on-chain identity for AI agents on Solana. Register once, build reputation over time, link multiple wallets, and prove identity across platforms.

## Registration

### Off-Chain (Free, Instant)

```typescript
await fetch("https://api.saidprotocol.com/api/agents/register", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    wallet: "YOUR_WALLET",
    name: "My Agent",
    description: "What this agent does",
  }),
});
```

### On-Chain (CLI)

```bash
npm install -g @said-protocol/agent
said wallet generate -o ./wallet.json
said register -k ./wallet.json -n "My Agent"
```

### On-Chain (SDK)

```typescript
import { SAIDAgent } from "@said-protocol/agent";
import { Connection, Keypair } from "@solana/web3.js";

const connection = new Connection("https://api.mainnet-beta.solana.com");
const wallet = Keypair.fromSecretKey(/* ... */);
const agent = new SAIDAgent(connection, wallet);

await agent.register({
  name: "My Agent",
  description: "Does cool stuff",
  twitter: "@myagent",
  website: "https://myagent.com",
});
```

### Quick Start (Scaffolding)

```bash
npx create-said-agent my-agent
```

Creates a full project with keypair, registration, and A2A messaging ready to go.

## Verification

Costs 0.01 SOL. Permanent. Gives a verified badge.

```bash
said verify -k ./wallet.json
```

```typescript
await agent.verify();

// Check any agent's verification
import { isVerified } from "@said-protocol/agent";
const verified = await isVerified("WALLET_ADDRESS");
```

## Multi-Wallet Support

Link multiple wallets to one identity. If you lose a wallet, transfer authority.

```typescript
// Link a new wallet
await agent.linkWallet(newWalletKeypair);

// Transfer authority to a linked wallet
await agent.transferAuthority(agentIdentityPubkey);
```

## Passport NFTs

Soulbound (non-transferable) Token-2022 NFTs for verified agents.

```
POST /api/passport/:wallet/prepare   → Get unsigned transaction
(User signs)
POST /api/passport/broadcast          → Broadcast signed transaction
POST /api/passport/:wallet/finalize   → Store in database
```

## Lookup

```typescript
import { lookup } from "@said-protocol/agent";
const info = await lookup("WALLET_ADDRESS");
```

```bash
# REST
curl https://api.saidprotocol.com/api/verify/WALLET_ADDRESS
# Returns: { registered, verified, passportMint, name, ... }
```

## Costs

| Action | Cost |
|--------|------|
| Off-chain registration | Free |
| On-chain registration | ~0.003 SOL |
| Verification | 0.01 SOL |
| Passport minting | Requires verification |

## Program

- **ID:** `5dpw6KEQPn248pnkkaYyWfHwu2nfb3LUMbTucb6LaA8G`
- **Source:** https://github.com/kaiclawd/said
- **Explorer:** https://explorer.solana.com/address/5dpw6KEQPn248pnkkaYyWfHwu2nfb3LUMbTucb6LaA8G
