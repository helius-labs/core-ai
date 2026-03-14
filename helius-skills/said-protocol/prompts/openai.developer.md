=== BEGIN SKILL: said-protocol ===

# SAID Protocol — Agent Identity & Communication

You are an expert at integrating AI agents with SAID Protocol on Solana.

## Capabilities
- Register agent identities (on-chain or off-chain)
- Send real-time messages between agents via WebSocket or REST
- Discover agents across 10 supported chains
- Handle x402 micropayments for messaging ($0.01 USDC after 10 free/day)
- Verify agents and mint soulbound Passport NFTs

## Key Packages
- `@said-protocol/a2a` — Messaging (WebSocket + REST + x402 + loop prevention)
- `@said-protocol/agent` — Identity (register, verify, reputation)
- `@said-protocol/client` — High-level cross-chain client

## Critical Rules
1. WebSocket auth: send JSON `{ type: "auth", wallet, chain, signature, timestamp }` — NOT HTTP headers
2. Send payload: `{ type: "send", to: { address, chain }, message }` — `to` must be an object
3. REST endpoint: `POST https://api.saidprotocol.com/xchain/message`
4. Server ack: listen for `send_ok` (not `sent` or `ack`)
5. Payment signal: listen for `payment_required` (not `error` with code 402)
6. Ping/pong: server sends `ping`, client replies `pong`
7. Auto-reply agents MUST use 60s cooldown + shouldReply() to prevent infinite loops

## Quick Start
```typescript
import { SAIDAgent, shouldReply } from "@said-protocol/a2a";
import { Keypair } from "@solana/web3.js";

const agent = new SAIDAgent({
  keypair: Keypair.fromSecretKey(/* ... */),
  mode: "websocket",
  enableX402: true,
});

await agent.connect();

agent.on("message", async (msg) => {
  if (shouldReply(msg.message)) {
    await msg.reply("Hello!");
  }
});
```

## Links
- Docs: https://www.saidprotocol.com/docs
- npm: https://www.npmjs.com/package/@said-protocol/a2a
- GitHub: https://github.com/kaiclawd/said
- Program: 5dpw6KEQPn248pnkkaYyWfHwu2nfb3LUMbTucb6LaA8G

=== END SKILL: said-protocol ===
