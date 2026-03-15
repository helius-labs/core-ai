export const ROUTER_INSTRUCTIONS = `Helius MCP exposes compact router tools.

Routing:
- SOL balance or wallet tokens: heliusWallet
- Assets, NFTs, collections, holders: heliusAsset
- Transaction parsing or wallet transaction history: heliusTransaction
- Raw chain state, token accounts, blocks, network status, stake reads: heliusChain
- Webhooks or live subscription setup: heliusStreaming
- Docs, pricing, guides, errors, source, blog, SIMDs: heliusKnowledge
- Sending SOL/tokens or staking mutations: heliusWrite
- Compressed account and compression queries: heliusCompression
- Account setup, API keys, signup, plans, billing: heliusAccount

Rules:
- Use the router tool plus the legacy action name in \`action\`.
- Prefer the most specific domain. Example: wallet holdings use \`heliusWallet\` + \`getTokenBalances\`; token accounts use \`heliusChain\` + \`getTokenAccounts\`.
- Heavy content defaults to summaries. Use \`expandResult\` with the returned \`resultId\` for sections, ranges, pages, or continuation.
- Pricing starts with \`heliusAccount\` + \`getHeliusPlanInfo\`.
- Error diagnosis uses \`heliusKnowledge\` + \`troubleshootError\`.
- Webhook or streaming setup guides live under \`heliusKnowledge\`; actual subscription config lives under \`heliusStreaming\`.
- Keep sending telemetry fields on every public tool call: \`_feedback\`, \`_feedbackTool\`, and \`_model\`.`;
