import type { RoutedPublicToolName } from './action-groups.js';
import type { ActionName } from './actions.js';

/**
 * One line per action for its tool's description: what it returns or does,
 * and what an agent must know before calling it (cost, plan, side effects).
 * Required parameters are added from the schemas, so they are not repeated.
 * Name an action in another tool as `tool.action`.
 */
export const ACTION_SUMMARIES: Record<ActionName, string> = {
  // heliusAccount
  getStarted: 'Setup status (API key, local keypair, account session) and the next step to take. Works without an API key.',
  setHeliusApiKey: 'Use an existing API key for this session and save it to the local config. Not needed when HELIUS_API_KEY is set.',
  generateKeypair: 'Create the local Solana keypair that pays for signup, or load the existing one, and return its address.',
  signup: 'Create a Helius account paid in USDC (Agent plan by default). Run generateKeypair first. A new account needs email, firstName, and lastName. mode "resume" finishes a signup the user paid for in the browser.',
  getAccountStatus: 'Current plan, remaining credits, rate limits, and billing cycle. Needs an account session, not only an API key.',
  createApiKey: 'Create an API key on the project and use it for this session. Each call creates another key.',
  getAccountPlan: 'Current plan, credit balance, and which actions need a higher plan. Costs 0 credits.',
  getHeliusPlanInfo: 'Plan pricing, monthly credits, rate limits, and features, for one plan or all of them.',
  compareHeliusPlans: 'Side-by-side comparison of all plans on rates, features, or pricing.',
  previewUpgrade: 'Price an upgrade to a plan, with proration and the amount due today. Does not pay.',
  upgradePlan: 'Upgrade to a subscription plan, paid in USDC. First-time upgrades need email, firstName, and lastName.',
  payRenewal: 'Pay a pending subscription renewal in USDC.',
  purchaseCredits: 'Agent plan only: buy prepaid credits in USDC, 1,000,000 credits per qty at $10 each.',

  // heliusWallet
  getBalance: 'Native SOL balance only, in SOL and lamports. 1 credit.',
  getTokenBalances: 'SPL token holdings with names, symbols, amounts, and USD prices; fetches every page. 10 credits per page.',
  getWalletBalances: 'Full portfolio: SOL, SPL, and Token-2022 balances with USD values, sorted by value; showNfts adds NFTs.',
  getWalletBalanceAt: 'Exact balance of one token, or SOL, at a past time, datetime, or slot. Pass exactly one of the three.',
  getWalletHistory: 'Transactions with the balance changes each one made to the wallet.',
  getWalletTransfers: 'Token and SOL sends and receives with direction, counterparty, and amount.',
  getWalletIdentity: 'Who a wallet belongs to (exchange, protocol, institution). Also resolves an SNS/ANS domain on mainnet.',
  batchWalletIdentity: 'getWalletIdentity for up to 100 addresses or domains at once.',
  getWalletFundedBy: 'The wallet that first funded this one, with its identity when known.',

  // heliusAsset
  getAsset: 'Full metadata for one asset (id) or up to 1,000 (ids): name, image, owner, creators, authorities, supply, royalties.',
  getAssetsByOwner: 'NFTs and other digital assets a wallet owns, compressed NFTs included.',
  searchAssets: 'Search assets by owner, creator, authority, name, or compressed, burnt, or frozen status.',
  getAssetsByGroup: 'Every asset in a group, usually a collection: groupKey "collection", groupValue the collection mint.',
  getAssetProof: 'Merkle proof for one compressed NFT, needed to transfer or burn it.',
  getAssetProofBatch: 'Merkle proofs for up to 1,000 compressed NFTs.',
  getSignaturesForAsset: 'Signatures of the transactions that touched one asset.',
  getNftEditions: 'Edition prints of a master NFT.',
  getTokenHolders: 'Top 20 holders of a token, with raw balances. About 20 credits.',

  // heliusTransaction
  parseTransactions: 'Decode transactions by signature into type, instructions, transfers, fees, and errors. showRaw adds raw instruction data. 10 credits per 100 signatures on mainnet.',
  getTransactionHistory: 'An address\'s transactions, newest first by default. mode "parsed" (default, about 20 credits) decodes them; "signatures" and "raw" cost about 10. Filter by status, time, or slot.',
  scanTransactionHistory: 'Find the transactions in an address\'s history that call given programs or touch given mints, without paging through all of it. Mainnet only. 10 credits plus 1 per history page scanned (up to 1,000 transactions each).',
  getTransfersByAddress: 'One row per SOL or token transfer (not per transaction), filtered by mint, direction, counterparty (with), amount, time, or slot.',

  // heliusChain
  getAccountInfo: 'Raw state of one account or up to 100: owner, lamports, data, executable. jsonParsed shows mint and Token-2022 details. 1 credit.',
  getHistoricalAccountInfo: 'One account as it was at a past slot, or right after a given transaction in that slot. Business plan or higher, mainnet only, 0 credits.',
  getTokenAccounts: 'Token accounts filtered by owner, mint, or both, with balances. 10 credits.',
  getHistoricalTokenAccountsByOwner: 'Every token account a wallet owned at a past slot or transaction. Keep slot the same on every page. Business plan or higher, mainnet only, 0 credits.',
  getProgramAccounts: 'Accounts owned by a program, optionally filtered by data size. Can be large: page with limit and paginationKey. 10 credits.',
  getBlock: 'A block by slot: time, blockhash, parent, transaction count, and rewards. transactionDetails sets how much transaction data. 10 credits.',
  getNetworkStatus: 'Epoch, slot, TPS, SOL supply, cluster version, and block height. 4 credits.',
  getPriorityFeeEstimate: 'Recommended priority fees in microlamports at each level, optionally for given accounts. 1 credit.',
  simulateTransaction: 'Dry-run a base64 transaction: success or error, compute units, logs, and optionally account state after. Sends nothing. 1 credit.',
  simulateBundle: 'Dry-run up to 5 base64 transactions in order as a Jito bundle. Sends nothing. 1 credit.',
  getBundleStatuses: 'Landing status, slot, and signatures for up to 5 Jito bundle IDs. 1 credit.',
  getStakeAccounts: 'A wallet\'s stake accounts delegated to the Helius validator, with amounts and activation status.',
  getWithdrawableAmount: 'SOL that can be withdrawn now from a stake account; 0 while it is active or cooling down.',

  // heliusStreaming
  createWebhook: 'Create a webhook that POSTs parsed transactions for the given addresses to your URL. 100 credits, plus 1 per delivered event.',
  getAllWebhooks: 'List your webhooks with IDs, URLs, addresses, and whether each is enabled. 100 credits.',
  getWebhookByID: 'One webhook\'s configuration. 100 credits.',
  updateWebhook: 'Change a webhook\'s URL, addresses, or transaction types; a list you pass replaces the old one. 100 credits.',
  deleteWebhook: 'Permanently delete a webhook and stop its deliveries. 100 credits.',
  toggleWebhook: 'Pause or re-enable a webhook without deleting it, including one Helius disabled for endpoint failures. 100 credits.',
  transactionSubscribe: 'Enhanced WebSocket config and code for streaming transactions that match account, vote, failed, or signature filters. Developer plan or higher.',
  accountSubscribe: 'Enhanced WebSocket config and code for streaming changes to one account. Developer plan or higher.',
  laserstreamSubscribe: 'LaserStream gRPC config and code for the lowest-latency stream of slots, accounts, transactions, blocks, or entries, with up to 48 hours of replay. Mainnet needs Business or higher; devnet, Developer.',
  describeProgram: 'A program\'s instruction, event, and account role names exactly as Parsed Streams filters match them. Call before parsedTransactionSubscribe.',
  getPreConfCoverage: 'Share of mainnet stake that Preconfirmations covers, split by region.',
  parsedTransactionSubscribe: 'Request and code for streaming decoded transactions filtered by program, instruction name, and account role. 1 credit per event.',
  preconfSubscribe: 'Request and code for Preconfirmations, the earliest transaction signal, for latency-critical trading. An early signal, not a guarantee. Developer plan or higher; each slot that delivers a message costs 10 credits per message, at least 300.',
  preprocessedSubscribe: 'Request and code for signed transactions before execution, filtered by account; no status or logs. Developer plan or higher, 0.1 credits per message.',

  // heliusKnowledge
  lookupHeliusDocs: 'Helius docs by topic; pass section to fetch only the part you need.',
  listHeliusDocTopics: 'The topics lookupHeliusDocs accepts.',
  getHeliusCreditsInfo: 'Credit cost table for Helius APIs.',
  getRateLimitInfo: 'Rate limits and credit costs per API method, by plan.',
  troubleshootError: 'Cause and fix for a Helius or Solana error: JSON-RPC code, HTTP status, or WebSocket close code. Use first for any error.',
  recommendStack: 'Helius products, actions, credit costs, and minimum plan for an app you describe.',
  getSIMD: 'A Solana Improvement Document by number, in full.',
  listSIMDs: 'All SIMD numbers and titles.',
  searchSolanaDocs: 'Search the official Solana docs (solana.com/docs).',
  readSolanaSourceFile: 'Read a file from the Agave or Firedancer repository by path.',
  fetchHeliusBlog: 'A Helius blog post by slug, or the list of posts (optionally by category) when slug is omitted.',
  getPumpFunGuide: 'How to query pump.fun tokens and track their graduations.',
  getSenderInfo: 'Helius Sender for transaction submission: routing, tips, latency, and best practices.',
  getWebhookGuide: 'Webhook delivery guarantees, latency, configuration, and troubleshooting.',
  getLatencyComparison: 'Latency of Standard WebSockets, Enhanced WebSockets, LaserStream, and Shred Stream compared.',
  getEnhancedWebSocketInfo: 'Enhanced WebSocket capabilities, endpoints, and plan requirements.',
  getLaserstreamInfo: 'LaserStream gRPC capabilities, regions, pricing, and plan requirements.',

  // heliusWrite
  transferSol: 'Send SOL through Helius Sender. sendMax sends the whole balance minus fees.',
  transferToken: 'Send an SPL token, creating the recipient\'s token account if needed. sendMax sends all of it and closes the sender\'s token account.',
  stakeSOL: 'Stake SOL to the Helius validator from a new stake account; about 0.00228 SOL rent is added on top.',
  unstakeSOL: 'Deactivate a stake account. It becomes withdrawable after about one epoch (2-3 days).',
  withdrawStake: 'Withdraw SOL from a deactivated stake account; by default all of it, which closes the account.',

  // heliusCompression
  getCompressedAccount: 'One compressed account by address or hash: data, lamports, owner, and tree.',
  getCompressedAccountsByOwner: 'A wallet\'s compressed accounts.',
  getMultipleCompressedAccounts: 'Several compressed accounts by addresses or hashes.',
  getCompressedBalance: 'Compressed SOL balance of one account, by address or hash.',
  getCompressedBalanceByOwner: 'Total compressed SOL across a wallet\'s accounts.',
  getCompressedMintTokenHolders: 'Holders of a compressed token mint, with balances.',
  getCompressedTokenAccountBalance: 'Balance of one compressed token account, by address or hash.',
  getCompressedTokenAccountsByOwner: 'A wallet\'s compressed token accounts, optionally for one mint.',
  getCompressedTokenAccountsByDelegate: 'Compressed token accounts delegated to an address, optionally for one mint.',
  getCompressedTokenBalancesByOwnerV2: 'A wallet\'s compressed token balances, one per mint.',
  getCompressedAccountProof: 'Merkle proof for one compressed account, for building transactions.',
  getMultipleCompressedAccountProofs: 'Merkle proofs for several compressed accounts.',
  getMultipleNewAddressProofs: 'Non-inclusion proofs for new addresses, needed to create compressed accounts.',
  getCompressionSignaturesForAccount: 'Signatures of the transactions that changed one compressed account.',
  getCompressionSignaturesForAddress: 'Compression transaction signatures for an address.',
  getCompressionSignaturesForOwner: 'Compression transaction signatures for a wallet\'s accounts.',
  getCompressionSignaturesForTokenOwner: 'Compression transaction signatures for a wallet\'s token accounts.',
  getLatestCompressionSignatures: 'The most recent compression transactions network-wide.',
  getLatestNonVotingSignatures: 'The most recent non-voting compression transactions network-wide.',
  getTransactionWithCompressionInfo: 'The compressed accounts a transaction opened and closed.',
  getValidityProof: 'ZK validity proof for a transaction that changes compressed state.',
  getIndexerHealth: 'Whether the ZK Compression indexer is healthy.',
  getIndexerSlot: 'The latest slot the ZK Compression indexer has processed.',

  // heliusPrivacy
  getEncryptedUtxosByTags: 'Encrypted outputs whose view tag matches, oldest first, spent ones included. In the default ring a wallet\'s view tag is its address.',
  getShieldedTransactionsByTags: 'Whole shielded transactions (outputs, messages, nullifiers) matching view tags, oldest first, for syncing a wallet.',
  getShieldedTransactionsByNullifiers: 'Transactions that spent any of these nullifiers; a nullifier with no match is unspent.',
  getShieldedTransactionsBySignature: 'One transaction\'s shielded events. Returns none, not an error, if it has none or is not indexed yet.',
  getMerkleProofs: 'Inclusion proofs for UTXO hashes in the UTXO tree, for a spend. Fails if any UTXO is missing.',
  getNonInclusionProofs: 'Proofs that nullifiers are not yet in the nullifier tree, for a spend. Fails if any is already used.',
  getUserRecords: 'Whether wallets are registered for Privacy Rings, and the public keys a sender encrypts to.',

  // heliusLana
  ask: 'Ask Lana a question in plain English; it chains the lookups itself and answers with its findings.',
};

/**
 * Public descriptions for fields whose actions describe them differently.
 * Every other field takes the description its actions share. A test fails
 * when actions disagree on a field that has no entry here.
 */
export const FIELD_DESCRIPTIONS: Partial<Record<RoutedPublicToolName, Record<string, string>>> = {
  heliusAccount: {
    mode: '"link" (default) returns a checkout URL; "autopay" pays USDC from the local keypair at once; "resume" (signup) finishes a browser payment.',
    plan: 'Plan: "agent", "developer", "business", or "professional". getHeliusPlanInfo also takes "all", its default. Upgrades take a subscription plan, not "agent".',
    period: 'Billing period: "monthly" (default) or "yearly". Ignored for the Agent plan.',
    email: 'Contact email. Needed to create an account or for a first upgrade.',
    firstName: 'First name. Needed to create an account or for a first upgrade.',
    lastName: 'Last name. Needed to create an account or for a first upgrade.',
    couponCode: 'Optional coupon code.',
  },
  heliusWallet: {
    address: 'Wallet address (base58). getWalletIdentity also accepts an SNS/ANS domain such as toly.sol (mainnet only).',
    limit: 'Results per page, up to 100.',
  },
  heliusAsset: {
    id: 'Asset mint address (base58). For getAsset, pass id or ids, not both.',
    ids: 'Asset mint addresses (base58), up to 1,000.',
    limit: 'Results per page, up to 1,000.',
    page: 'Page number, starting at 1 (default).',
    mint: 'Mint address (base58): the token for getTokenHolders, the master NFT for getNftEditions.',
  },
  heliusTransaction: {
    address: 'Address (base58): a wallet, program, or token mint. To scan, use the narrowest one; all its transactions count toward the budget.',
    limit: 'Results per page, up to 100 (1,000 for getTransactionHistory signatures mode). Default 10, or 25 for getTransfersByAddress.',
    tokenAccounts: 'Include transactions that touch only the address\'s token accounts: "none", "balanceChanged" (catches incoming token transfers), or "all".',
  },
  heliusChain: {
    address: 'Account address (base58); the owner wallet for getHistoricalTokenAccountsByOwner. getAccountInfo takes address or addresses.',
    addresses: 'Account addresses (base58): up to 100 for getAccountInfo, or the accounts whose state a simulation returns.',
    encoding: 'Data encoding: "jsonParsed", "base64", or "base58". Historical actions take "jsonParsed" (default), "base64", or "base64+zstd".',
    slot: 'getBlock: the block to fetch. Historical actions: read state at the end of this slot (444959999 or later); omit for the latest.',
    commitment: '"finalized" or "confirmed"; simulateTransaction also takes "processed". Historical actions default to "finalized".',
    mint: 'Token mint (base58) to filter by. For getHistoricalTokenAccountsByOwner, pass mint or programId, not both.',
    limit: 'Results per page: up to 1,000 token accounts (historical default 100), or up to 100 program accounts (default 20).',
    programId: 'Program whose accounts to list; for getHistoricalTokenAccountsByOwner, a token program filter (not with mint).',
    paginationKey: 'Cursor from the previous getProgramAccounts response, for the next page. getHistoricalTokenAccountsByOwner accepts it as an alias of paginationToken.',
    sigVerify: 'Verify signatures. Needs a valid recent blockhash and turns off replaceRecentBlockhash.',
    replaceRecentBlockhash: 'Replace the recent blockhash with the latest before simulating (default true), so unsigned or stale transactions can be simulated. Ignored when sigVerify is true.',
  },
  heliusStreaming: {
    webhookURL: 'URL that receives the webhook POSTs.',
    webhookType: 'Webhook type, such as "enhanced" for parsed transactions with descriptions. updateWebhook needs it too.',
    accountAddresses: 'Addresses to monitor (base58), up to 100,000. On update, replaces the existing list.',
    transactionTypes: 'Transaction types that trigger the webhook, such as ["SWAP", "NFT_SALE"], or ["ANY"] for all. On update, replaces the existing filters.',
    webhookID: 'ID of the webhook to read or change.',
    failed: 'transactionSubscribe: include failed transactions. preconfSubscribe: true for only failed, false for only successful; omit for both.',
    accountInclude: 'Accounts (base58), any of which a transaction must involve. Limits: transactionSubscribe 50,000, preconfSubscribe 10,000, preprocessedSubscribe 5,000, parsedTransactionSubscribe 100.',
    accountExclude: 'Drop transactions that involve any of these accounts (base58). Wins over accountInclude.',
    accountRequired: 'Accounts (base58) a transaction must involve, all of them.',
    commitment: '"processed", "confirmed", or "finalized". Defaults: "confirmed" for transactionSubscribe, "finalized" for accountSubscribe.',
    encoding: '"base58", "base64", "jsonParsed", or (accountSubscribe only) "base64+zstd". Defaults: "jsonParsed" for transactions, "base58" for accounts.',
  },
  heliusKnowledge: {
    query: 'Search terms. lookupHeliusDocs uses them to pick a topic when topic is omitted.',
  },
  heliusWrite: {
    amount: 'Amount in whole units, such as 0.5 SOL or 10 USDC. Transfers need it unless sendMax is true. withdrawStake withdraws everything when it is omitted.',
    sendMax: 'Send the whole balance: SOL minus fees, or all of a token, closing the sender\'s token account. amount is ignored.',
    owsWallet: 'Open Wallet Standard wallet to sign with instead of the local keypair. Needs the ows CLI.',
    stakeAccount: 'Stake account address (base58). Find yours with heliusChain.getStakeAccounts.',
  },
  heliusCompression: {
    address: 'Compressed account address (base58). Single-account reads take address or hash.',
    hash: 'Compressed account hash (base58, 32-byte leaf hash). Single-account reads take address or hash.',
    owner: 'Owner wallet address (base58).',
    addresses: 'getMultipleCompressedAccounts: compressed account addresses (base58), with or instead of hashes. getMultipleNewAddressProofs: {address, tree} pairs.',
    hashes: 'Compressed account hashes (base58).',
    mint: 'Token mint (base58): the mint for getCompressedMintTokenHolders, or a filter for the by-owner and by-delegate reads.',
  },
  heliusPrivacy: {
    tags: 'View tags (base58), up to 1,000. In the default ring a wallet\'s view tag is its address. Leave empty only with ringProgramId, to read that ring\'s whole history.',
    ringProgramId: 'Only this ring program. With no tags, returns that ring\'s whole history.',
    treeAccount: 'Rings tree account (PDA): the UTXO tree for getMerkleProofs, the nullifier tree for getNonInclusionProofs.',
    leaves: '1 to 64 values (base58): UTXO hashes for getMerkleProofs, nullifiers for getNonInclusionProofs.',
  },
};

/**
 * Behavior the action list does not cover: side effects, cost, pagination,
 * and where neighbouring requests go. Read-only text must not name actions
 * that surface removes.
 */
export const TOOL_NOTES: Partial<Record<RoutedPublicToolName, { full: string; readOnly?: string }>> = {
  heliusAccount: {
    full: 'signup, upgradePlan, payRenewal, and purchaseCredits spend USDC. mode "link" (default) only returns a checkout URL for the user to pay; mode "autopay" pays from the local keypair at once, so confirm the plan and amount with the user before using it. Per-method credit costs and rate limits are heliusKnowledge.getRateLimitInfo.',
    readOnly: 'Per-method credit costs and rate limits are heliusKnowledge.getRateLimitInfo.',
  },
  heliusWallet: {
    full: 'All actions are read-only. getWalletIdentity, batchWalletIdentity, and getWalletFundedBy need the Developer plan or higher. Every action except getBalance and getTokenBalances costs 100 credits. Full transaction history is heliusTransaction; raw token accounts are heliusChain.getTokenAccounts.',
  },
  heliusAsset: {
    full: 'All actions are read-only and cost about 10 credits (DAS API) unless their line says otherwise. List actions page with page and limit. Wallet balances with prices are heliusWallet; compressed accounts that are not NFTs are heliusCompression.',
  },
  heliusTransaction: {
    full: 'All actions are read-only. Paginated actions return a paginationToken (getTransactionHistory in signatures mode, a before signature): call again with it and the same parameters for the next page. Large results come back summary-first with a resultId for expandResult. Balances and holdings are heliusWallet; raw account state is heliusChain.',
  },
  heliusChain: {
    full: 'All actions are read-only; simulations never submit. Historical actions read state from slot 444959999 (September 7, 2026) on. Wallet portfolios are heliusWallet; parsed transactions are heliusTransaction; NFT and token metadata are heliusAsset.',
  },
  heliusStreaming: {
    full: 'createWebhook, updateWebhook, deleteWebhook, and toggleWebhook change your webhooks, and deleteWebhook cannot be undone. The subscribe actions only return a request and code; they never open a connection. Enhanced WebSocket and LaserStream data costs 2 credits per 0.1 MB. How-to guides and latency comparisons are heliusKnowledge.',
    readOnly: 'The subscribe actions only return a request and code; they never open a connection. Enhanced WebSocket and LaserStream data costs 2 credits per 0.1 MB. How-to guides and latency comparisons are heliusKnowledge.',
  },
  heliusKnowledge: {
    full: 'All actions are read-only, and every action except recommendStack works without an API key. Long documents come back summary-first: use section, or expandResult with the resultId. Live webhook and subscription setup is heliusStreaming; plan pricing is heliusAccount.',
  },
  heliusWrite: {
    full: 'Every action signs and sends an irreversible transaction from the local keypair (heliusAccount.generateKeypair), or from owsWallet when given, and returns its signature. Confirm the recipient and amount with the user first. About 3 credits each (13 for transferToken). Stake accounts and withdrawable amounts are in heliusChain.',
  },
  heliusCompression: {
    full: 'All actions are read-only and cost 10 credits (ZK Compression RPC). List actions page with limit and cursor. Regular NFTs and compressed NFTs are heliusAsset.',
  },
  heliusPrivacy: {
    full: 'All actions are read-only and cost 10 credits. The view-tag and nullifier reads page with limit and paginationToken.',
  },
};
