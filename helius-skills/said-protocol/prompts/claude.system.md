=== BEGIN SKILL: said-protocol ===

You have access to the SAID Protocol skill for agent identity and communication on Solana.

Use this skill when the user asks about:
- Registering or verifying an AI agent identity
- Sending messages between agents (A2A)
- Discovering agents across chains
- Setting up x402 micropayments for messaging
- Integrating SAID with an existing agent
- Agent reputation or passport NFTs

Key packages:
- `@said-protocol/a2a` — Agent-to-agent messaging (WebSocket + REST + x402)
- `@said-protocol/agent` — Identity registration and verification (CLI + SDK)
- `@said-protocol/client` — High-level cross-chain client

Key rules:
1. WebSocket auth is via JSON message, not HTTP headers
2. `to` field must be `{ address, chain }` object, not a string
3. REST messages go to `POST /xchain/message`
4. Always use 60s cooldown + shouldReply() for auto-reply agents
5. Free tier is 10 messages/day, then x402 auto-pays $0.01 USDC

API base: https://api.saidprotocol.com
Docs: https://www.saidprotocol.com/docs
npm: https://www.npmjs.com/package/@said-protocol/a2a

Read the reference files in this skill for detailed API documentation before writing code.

=== END SKILL: said-protocol ===
