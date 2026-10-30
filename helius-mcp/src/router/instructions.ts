import type { Surface } from './surface.js';

export const ROUTER_INSTRUCTIONS = `Helius MCP exposes 10 public tools total: 9 routed domain tools plus \`expandResult\`.

Choose tools by user intent, not by name similarity.

Routing:
- Account setup, API keys, signup, plans, billing: \`heliusAccount\`
- Wallet-centric balances, holdings, identity, wallet history: \`heliusWallet\`
- Assets, NFTs, collections, token holders: \`heliusAsset\`
- Parsed transactions or wallet transaction history: \`heliusTransaction\`
- Raw chain state, token accounts, stake reads, blocks, network status, priority fees, transaction or Jito bundle simulation, bundle status: \`heliusChain\`
- Webhook CRUD, live subscription configuration, Parsed Streams program discovery, Preconfirmations coverage: \`heliusStreaming\`
- Docs, guides, pricing references, troubleshooting, source, blog, SIMDs: \`heliusKnowledge\`
- SOL/token transfers or staking mutations: \`heliusWrite\`
- Compressed account, proof, balance, compression history: \`heliusCompression\`

Rules:
- Use the chosen routed tool plus the Helius action name in \`action\`.
- Wallet holdings use \`heliusWallet.getTokenBalances\`; raw token accounts use \`heliusChain.getTokenAccounts\`.
- Parsed transaction details use \`heliusTransaction.parseTransactions\`; wallet activity listing uses \`heliusTransaction.getTransactionHistory\`; per-transfer rows (token + SOL with mint/direction/counterparty filters) use \`heliusTransaction.getTransfersByAddress\`.
- Streaming or webhook setup guides live under \`heliusKnowledge\`; actual webhook/subscription config lives under \`heliusStreaming\`.
- Pricing and plan selection start with \`heliusAccount.getHeliusPlanInfo\`; per-method credit costs or rate limits use \`heliusKnowledge.getRateLimitInfo\` or \`heliusKnowledge.getHeliusCreditsInfo\`.
- Read queries stay on domain tools; sends and staking mutations use \`heliusWrite\`.
- Heavy content is summary-first. Use \`expandResult\` with the returned \`resultId\` for sections, ranges, pages, or continuation.
- Set \`_feedback\` to a short reason for the call or takeaway from the previous result. Avoid placeholders like \`first_call\`.
- Set \`_feedbackTool\` to the current \`publicTool.action\`, e.g. \`heliusWallet.getBalance\`. Always send \`_model\`.`;

export const READ_ONLY_ROUTER_INSTRUCTIONS = `Helius MCP (read-only) exposes 9 public tools total: 8 routed domain tools plus \`expandResult\`.

This server cannot change state: it does not send or sign transactions, stake, create or edit webhooks, sign up, or pay. When a user asks for one of those, say so and point them to the full Helius MCP (\`npx helius-mcp@latest\`).

Choose tools by user intent, not by name similarity.

Routing:
- Account status, plans, pricing, upgrade previews: \`heliusAccount\`
- Wallet-centric balances, holdings, identity, wallet history: \`heliusWallet\`
- Assets, NFTs, collections, token holders: \`heliusAsset\`
- Parsed transactions or wallet transaction history: \`heliusTransaction\`
- Raw chain state, token accounts, stake reads, blocks, network status, priority fees, transaction or Jito bundle simulation, bundle status: \`heliusChain\`
- Webhook lookups, live subscription configuration, Parsed Streams program discovery, Preconfirmations coverage: \`heliusStreaming\`
- Docs, guides, pricing references, troubleshooting, source, blog, SIMDs: \`heliusKnowledge\`
- Compressed account, proof, balance, compression history: \`heliusCompression\`

Rules:
- Use the chosen routed tool plus the Helius action name in \`action\`.
- Wallet holdings use \`heliusWallet.getTokenBalances\`; raw token accounts use \`heliusChain.getTokenAccounts\`.
- Parsed transaction details use \`heliusTransaction.parseTransactions\`; wallet activity listing uses \`heliusTransaction.getTransactionHistory\`; per-transfer rows (token + SOL with mint/direction/counterparty filters) use \`heliusTransaction.getTransfersByAddress\`.
- Streaming or webhook setup guides live under \`heliusKnowledge\`; webhook lookups and subscription configs live under \`heliusStreaming\`.
- Pricing and plan selection start with \`heliusAccount.getHeliusPlanInfo\`; per-method credit costs or rate limits use \`heliusKnowledge.getRateLimitInfo\` or \`heliusKnowledge.getHeliusCreditsInfo\`.
- Heavy content is summary-first. Use \`expandResult\` with the returned \`resultId\` for sections, ranges, pages, or continuation.
- Set \`_feedback\` to a short reason for the call or takeaway from the previous result. Avoid placeholders like \`first_call\`.
- Set \`_feedbackTool\` to the current \`publicTool.action\`, e.g. \`heliusWallet.getBalance\`. Always send \`_model\`.`;

export function getRouterInstructions(surface: Surface): string {
  return surface === 'readOnly' ? READ_ONLY_ROUTER_INSTRUCTIONS : ROUTER_INSTRUCTIONS;
}
