import type { Surface } from './surface.js';

export const ROUTER_INSTRUCTIONS = `Helius MCP exposes 11 public tools total: 10 routed domain tools plus \`expandResult\`.

Choose tools by user intent, not by name similarity.

Routing:
- Account setup, API keys, signup, plans, billing: \`heliusAccount\`
- Wallet-centric balances, holdings, identity, wallet history: \`heliusWallet\`
- Assets, NFTs, collections, token holders: \`heliusAsset\`
- Parsed transactions or wallet transaction history: \`heliusTransaction\`
- Raw chain state, token accounts, historical account state at a past slot or transaction, stake reads, blocks, network status, priority fees, transaction or Jito bundle simulation, bundle status: \`heliusChain\`
- Webhook CRUD, live subscription configuration, Parsed Streams program discovery, Preconfirmations coverage: \`heliusStreaming\`
- Docs, guides, pricing references, troubleshooting, source, blog, SIMDs: \`heliusKnowledge\`
- SOL/token transfers or staking mutations: \`heliusWrite\`
- Compressed account, proof, balance, compression history: \`heliusCompression\`
- Solana Privacy Rings: encrypted UTXOs, shielded transactions, Merkle or non-inclusion proofs, user records: \`heliusPrivacy\`

Rules:
- Use the chosen routed tool plus the Helius action name in \`action\`.
- Wallet holdings use \`heliusWallet.getTokenBalances\`; raw token accounts use \`heliusChain.getTokenAccounts\`.
- An account or a wallet's token accounts as they were at a past slot, or right after one transaction, use \`heliusChain.getHistoricalAccountInfo\` or \`heliusChain.getHistoricalTokenAccountsByOwner\` (beta, mainnet, Business+, slot 444959999 onward). Find a transaction's \`slot\` and \`transactionIndex\` with \`heliusTransaction.getTransactionHistory\`. One token balance at a timestamp uses \`heliusWallet.getWalletBalanceAt\`.
- Parsed transaction details use \`heliusTransaction.parseTransactions\`; wallet activity listing uses \`heliusTransaction.getTransactionHistory\`; per-transfer rows (token + SOL with mint/direction/counterparty filters) use \`heliusTransaction.getTransfersByAddress\`; searching an address's history for specific programs, instructions, or token mints uses \`heliusTransaction.scanTransactionHistory\`.
- Streaming or webhook setup guides live under \`heliusKnowledge\`; actual webhook/subscription config lives under \`heliusStreaming\`.
- Pricing and plan selection start with \`heliusAccount.getHeliusPlanInfo\`; per-method credit costs or rate limits use \`heliusKnowledge.getRateLimitInfo\` or \`heliusKnowledge.getHeliusCreditsInfo\`.
- Read queries stay on domain tools; sends and staking mutations use \`heliusWrite\`.
- \`heliusPrivacy\` returns ciphertext and proofs but cannot decrypt, derive view tags, or build transactions; wallets do that client-side with \`@heliuslabs/spr\`. Never put view tags, nullifiers, or keys in \`_feedback\`.
- Heavy content is summary-first. Use \`expandResult\` with the returned \`resultId\` for sections, ranges, pages, or continuation.
- Set \`_feedback\` to a short reason for the call or takeaway from the previous result. Avoid placeholders like \`first_call\`.
- Set \`_feedbackTool\` to the current \`publicTool.action\`, e.g. \`heliusWallet.getBalance\`. Always send \`_model\`.`;

export const READ_ONLY_ROUTER_INSTRUCTIONS = `Helius MCP (read-only) exposes 10 public tools total: 9 routed domain tools plus \`expandResult\`.

This server cannot change state: it does not send or sign transactions, stake, create or edit webhooks, sign up, or pay. When a user asks for one of those, say so and point them to the full Helius MCP (\`npx helius-mcp@latest\`).

Choose tools by user intent, not by name similarity.

Routing:
- Account status, plans, pricing, upgrade previews: \`heliusAccount\`
- Wallet-centric balances, holdings, identity, wallet history: \`heliusWallet\`
- Assets, NFTs, collections, token holders: \`heliusAsset\`
- Parsed transactions or wallet transaction history: \`heliusTransaction\`
- Raw chain state, token accounts, historical account state at a past slot or transaction, stake reads, blocks, network status, priority fees, transaction or Jito bundle simulation, bundle status: \`heliusChain\`
- Webhook lookups, live subscription configuration, Parsed Streams program discovery, Preconfirmations coverage: \`heliusStreaming\`
- Docs, guides, pricing references, troubleshooting, source, blog, SIMDs: \`heliusKnowledge\`
- Compressed account, proof, balance, compression history: \`heliusCompression\`
- Solana Privacy Rings: encrypted UTXOs, shielded transactions, Merkle or non-inclusion proofs, user records: \`heliusPrivacy\`

Rules:
- Use the chosen routed tool plus the Helius action name in \`action\`.
- Wallet holdings use \`heliusWallet.getTokenBalances\`; raw token accounts use \`heliusChain.getTokenAccounts\`.
- An account or a wallet's token accounts as they were at a past slot, or right after one transaction, use \`heliusChain.getHistoricalAccountInfo\` or \`heliusChain.getHistoricalTokenAccountsByOwner\` (beta, mainnet, Business+, slot 444959999 onward). Find a transaction's \`slot\` and \`transactionIndex\` with \`heliusTransaction.getTransactionHistory\`. One token balance at a timestamp uses \`heliusWallet.getWalletBalanceAt\`.
- Parsed transaction details use \`heliusTransaction.parseTransactions\`; wallet activity listing uses \`heliusTransaction.getTransactionHistory\`; per-transfer rows (token + SOL with mint/direction/counterparty filters) use \`heliusTransaction.getTransfersByAddress\`; searching an address's history for specific programs, instructions, or token mints uses \`heliusTransaction.scanTransactionHistory\`.
- Streaming or webhook setup guides live under \`heliusKnowledge\`; webhook lookups and subscription configs live under \`heliusStreaming\`.
- Pricing and plan selection start with \`heliusAccount.getHeliusPlanInfo\`; per-method credit costs or rate limits use \`heliusKnowledge.getRateLimitInfo\` or \`heliusKnowledge.getHeliusCreditsInfo\`.
- \`heliusPrivacy\` returns ciphertext and proofs but cannot decrypt, derive view tags, or build transactions; wallets do that client-side with \`@heliuslabs/spr\`. Never put view tags, nullifiers, or keys in \`_feedback\`.
- Heavy content is summary-first. Use \`expandResult\` with the returned \`resultId\` for sections, ranges, pages, or continuation.
- Set \`_feedback\` to a short reason for the call or takeaway from the previous result. Avoid placeholders like \`first_call\`.
- Set \`_feedbackTool\` to the current \`publicTool.action\`, e.g. \`heliusWallet.getBalance\`. Always send \`_model\`.`;

export function getRouterInstructions(surface: Surface): string {
  return surface === 'readOnly' ? READ_ONLY_ROUTER_INSTRUCTIONS : ROUTER_INSTRUCTIONS;
}
