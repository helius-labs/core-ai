import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

// Rate limit data by plan
const RATE_LIMITS = {
  free: {
    rpc: { rps: 10, burst: 15 },
    sendTransaction: { rps: 1 },
    getProgramAccounts: { rps: 5 },
    das: { rps: 2 },
    websocket: { connections: 5, enhanced: 0 },
  },
  developer: {
    rpc: { rps: 50, burst: 75 },
    sendTransaction: { rps: 5 },
    getProgramAccounts: { rps: 25 },
    das: { rps: 10 },
    websocket: { connections: 150, enhanced: 0 },
  },
  business: {
    rpc: { rps: 200, burst: 300 },
    sendTransaction: { rps: 50 },
    getProgramAccounts: { rps: 50 },
    das: { rps: 50 },
    websocket: { connections: 250, enhanced: 100 },
  },
  professional: {
    rpc: { rps: 500, burst: 750 },
    sendTransaction: { rps: 100 },
    getProgramAccounts: { rps: 75 },
    das: { rps: 100 },
    websocket: { connections: 250, enhanced: 100 },
  },
};

// Credit costs per method - aligned with official Helius docs
// Source: https://www.helius.dev/docs/billing/credits
const CREDIT_COSTS: Record<string, { cost: number | string; notes?: string }> = {
  // === 0 CREDITS ===
  'Helius Sender': { cost: 0, notes: 'Ultra-low latency transaction submission' },

  // === 1 CREDIT (Standard RPC) ===
  getBalance: { cost: 1 },
  getAccountInfo: { cost: 1 },
  getMultipleAccounts: { cost: 1 },
  getBlockHeight: { cost: 1 },
  getSlot: { cost: 1 },
  getLatestBlockhash: { cost: 1 },
  sendTransaction: { cost: 1, notes: 'Via staked connections' },
  simulateTransaction: { cost: 1 },
  getTokenAccountsByOwner: { cost: 1 },
  getProgramAccountsV2: { cost: 1, notes: 'Paginated version' },
  getTokenAccountsByOwnerV2: { cost: 1, notes: 'Paginated version' },
  simulateBundle: { cost: 1, notes: 'Jito bundle simulation' },
  'Priority Fee API': { cost: 1 },
  'getSignatureStatuses (recent)': { cost: 1, notes: 'With searchTransactionHistory: false' },

  // === 3 CREDITS (Data Streaming) ===
  'LaserStream gRPC': { cost: '3 per 0.1 MB', notes: 'Uncompressed data streamed' },
  'Enhanced WebSockets': { cost: '3 per 0.1 MB', notes: 'Uncompressed data streamed' },

  // === 10 CREDITS (Historical Data & DAS API) ===
  getProgramAccounts: { cost: 10, notes: 'Use getProgramAccountsV2 for 1 credit' },
  getBlock: { cost: 10, notes: 'Historical/archival data' },
  getBlocks: { cost: 10 },
  getBlocksWithLimit: { cost: 10 },
  getBlockTime: { cost: 10 },
  getTransaction: { cost: 10, notes: 'Historical/archival data' },
  getSignaturesForAddress: { cost: 10 },
  getInflationReward: { cost: 10 },
  'getSignatureStatuses (historical)': { cost: 10, notes: 'With searchTransactionHistory: true' },

  // DAS API (all 10 credits)
  getAsset: { cost: 10 },
  getAssetBatch: { cost: 10 },
  getAssetsByOwner: { cost: 10 },
  getAssetsByGroup: { cost: 10 },
  getAssetsByCreator: { cost: 10 },
  getAssetsByAuthority: { cost: 10 },
  searchAssets: { cost: 10 },
  getAssetProof: { cost: 10 },
  getAssetProofBatch: { cost: 10 },
  getNftEditions: { cost: 10 },
  getSignaturesForAsset: { cost: 10 },
  getTokenAccounts: { cost: 10 },

  // ZK Compression (10 credits)
  'ZK Compression API': { cost: 10 },

  // === 100 CREDITS (Enhanced APIs) ===
  'Enhanced Transactions API': { cost: 100, notes: 'parseTransactions, parsed history' },
  getTransactionsForAddress: { cost: 100, notes: 'Developer+ plans only' },
  getValidityProof: { cost: 100, notes: 'ZK Compression - computationally intensive' },

  // Wallet API (all 100 credits)
  'Wallet Identity': { cost: 100 },
  'Batch Identity Lookup': { cost: 100, notes: 'Up to 100 addresses' },
  'Wallet Balances': { cost: 100 },
  'Wallet History': { cost: 100 },
  'Token Transfers': { cost: 100 },
  'Wallet Funding Source': { cost: 100 },

  // Webhooks
  'Webhook Events': { cost: 1, notes: 'Per event delivered' },
  'Webhook Management': { cost: 100, notes: 'Create, edit, or delete' },
};

// Error codes and their meanings
const ERROR_CODES: Record<string, { meaning: string; causes: string[]; fixes: string[] }> = {
  '-32600': {
    meaning: 'Invalid Request',
    causes: [
      'Malformed JSON-RPC request',
      'Missing required parameters',
      'Invalid API key format',
    ],
    fixes: [
      'Verify JSON-RPC format (jsonrpc: "2.0", method, params, id)',
      'Check all required parameters are included',
      'Verify API key is valid and properly formatted',
    ],
  },
  '-32601': {
    meaning: 'Method Not Found',
    causes: ['Typo in method name', 'Method not supported on this endpoint'],
    fixes: ['Check method name spelling', 'Verify method is available on your plan'],
  },
  '-32602': {
    meaning: 'Invalid Params',
    causes: ['Wrong parameter types', 'Missing required params', 'Invalid encoding'],
    fixes: [
      'Check parameter types match docs',
      'Ensure all required params are provided',
      'Verify encoding (base58, base64, jsonParsed)',
    ],
  },
  '-32603': {
    meaning: 'Internal Error',
    causes: [
      'Backend service temporarily unavailable',
      'Node sync issues',
      'Rate limit on specific methods',
    ],
    fixes: [
      'Retry with exponential backoff',
      'Try a different region if available',
      'Check status.helius.dev for incidents',
    ],
  },
  '-32002': {
    meaning: 'Transaction Simulation Failed',
    causes: ['Insufficient funds', 'Invalid blockhash', 'Program error'],
    fixes: [
      'Check account balances',
      'Get fresh blockhash (valid ~60-90 seconds)',
      'Review program logs in error response',
    ],
  },
  '-32003': {
    meaning: 'Transaction Precompile Verification Failed',
    causes: ['Invalid signature', 'Wrong signer'],
    fixes: ['Verify all required signatures are present', 'Check signer keypairs'],
  },
  '-32429': {
    meaning: 'Rate Limit Exceeded (RPS)',
    causes: ['Too many requests per second', 'Burst limit exceeded'],
    fixes: [
      'Implement exponential backoff',
      'Reduce request frequency',
      'Upgrade plan for higher limits',
      'Use batch requests where possible',
    ],
  },
  '429': {
    meaning: 'Too Many Requests',
    causes: ['RPS limit exceeded', 'Credit quota exhausted', 'Concurrent request limit'],
    fixes: [
      'Check if credits exhausted (dashboard)',
      'Reduce request rate',
      'Implement request queuing',
      'Upgrade plan or buy more credits',
    ],
  },
  '401': {
    meaning: 'Unauthorized',
    causes: ['Invalid API key', 'Expired API key', 'Wrong endpoint for plan'],
    fixes: [
      'Verify API key in dashboard',
      'Regenerate API key if needed',
      'Check you are using correct endpoint for your plan',
    ],
  },
  '403': {
    meaning: 'Forbidden',
    causes: ['IP blocked by WAF', 'Feature not available on plan', 'CORS origin not allowed'],
    fixes: [
      'Check if your IP/hosting provider is blocked',
      'Verify feature is included in your plan',
      'Add your domain to allowed origins in dashboard',
    ],
  },
  '502': {
    meaning: 'Bad Gateway',
    causes: ['Backend temporarily unavailable', 'Auth service error', 'Node maintenance'],
    fixes: ['Retry after a few seconds', 'Check status.helius.dev', 'Try alternate region'],
  },
  '504': {
    meaning: 'Gateway Timeout',
    causes: ['Request took too long', 'Heavy query (large getProgramAccounts)', 'Node overloaded'],
    fixes: [
      'Add filters to reduce result size',
      'Use pagination',
      'Try during off-peak hours',
      'Consider dedicated node for heavy queries',
    ],
  },
  '1006': {
    meaning: 'WebSocket Abnormal Closure',
    causes: [
      '10-minute inactivity timeout',
      'Server-side disconnect',
      'Network interruption',
      'Too many subscriptions',
    ],
    fixes: [
      'Send ping every 30-60 seconds',
      'Implement automatic reconnection',
      'Reduce subscriptions per connection',
      'Use multiple connections for large subscription sets',
    ],
  },
};

export function registerGuideTools(server: McpServer) {
  // Tool 1: getRateLimitInfo
  server.tool(
    'getRateLimitInfo',
    'Get detailed rate limit information including RPS limits, credit costs per method, and burst windows. Helps understand the difference between credits (total monthly quota) and RPS (requests per second limit).',
    {
      plan: z
        .enum(['free', 'developer', 'business', 'professional', 'all'])
        .optional()
        .default('all')
        .describe('Plan to show rate limits for'),
      showCreditCosts: z
        .boolean()
        .optional()
        .default(true)
        .describe('Include credit costs per API method'),
    },
    async ({ plan, showCreditCosts }) => {
      const lines: string[] = [];

      lines.push('# Rate Limits & Credits Guide', '');
      lines.push('## Key Concepts', '');
      lines.push('- **Credits**: Monthly quota (1M, 10M, 100M, etc.). Each API call costs credits.');
      lines.push('- **RPS**: Requests per second limit. Even with credits remaining, you can hit RPS limits.');
      lines.push('- **Burst**: Brief allowance above RPS for short spikes.');
      lines.push('- **429 errors**: Can mean EITHER credits exhausted OR RPS exceeded. Check dashboard to distinguish.');
      lines.push('');

      // Rate limits table
      if (plan === 'all') {
        lines.push('## Rate Limits by Plan', '');
        lines.push('| Limit | Free | Developer | Business | Professional |');
        lines.push('|-------|------|-----------|----------|--------------|');
        lines.push(`| RPC RPS | ${RATE_LIMITS.free.rpc.rps} | ${RATE_LIMITS.developer.rpc.rps} | ${RATE_LIMITS.business.rpc.rps} | ${RATE_LIMITS.professional.rpc.rps} |`);
        lines.push(`| sendTransaction | ${RATE_LIMITS.free.sendTransaction.rps}/s | ${RATE_LIMITS.developer.sendTransaction.rps}/s | ${RATE_LIMITS.business.sendTransaction.rps}/s | ${RATE_LIMITS.professional.sendTransaction.rps}/s |`);
        lines.push(`| getProgramAccounts | ${RATE_LIMITS.free.getProgramAccounts.rps}/s | ${RATE_LIMITS.developer.getProgramAccounts.rps}/s | ${RATE_LIMITS.business.getProgramAccounts.rps}/s | ${RATE_LIMITS.professional.getProgramAccounts.rps}/s |`);
        lines.push(`| DAS API | ${RATE_LIMITS.free.das.rps}/s | ${RATE_LIMITS.developer.das.rps}/s | ${RATE_LIMITS.business.das.rps}/s | ${RATE_LIMITS.professional.das.rps}/s |`);
        lines.push(`| WS Connections | ${RATE_LIMITS.free.websocket.connections} | ${RATE_LIMITS.developer.websocket.connections} | ${RATE_LIMITS.business.websocket.connections} | ${RATE_LIMITS.professional.websocket.connections} |`);
        lines.push(`| Enhanced WS | ${RATE_LIMITS.free.websocket.enhanced} | ${RATE_LIMITS.developer.websocket.enhanced} | ${RATE_LIMITS.business.websocket.enhanced} | ${RATE_LIMITS.professional.websocket.enhanced} |`);
      } else {
        const limits = RATE_LIMITS[plan as keyof typeof RATE_LIMITS];
        lines.push(`## ${plan.charAt(0).toUpperCase() + plan.slice(1)} Plan Rate Limits`, '');
        lines.push(`- **RPC RPS**: ${limits.rpc.rps} (burst: ${limits.rpc.burst})`);
        lines.push(`- **sendTransaction**: ${limits.sendTransaction.rps}/sec`);
        lines.push(`- **getProgramAccounts**: ${limits.getProgramAccounts.rps}/sec`);
        lines.push(`- **DAS API**: ${limits.das.rps}/sec`);
        lines.push(`- **WebSocket Connections**: ${limits.websocket.connections}`);
        lines.push(`- **Enhanced WebSocket**: ${limits.websocket.enhanced}`);
      }

      if (showCreditCosts) {
        lines.push('', '## Credit Costs per Method', '');
        lines.push('| Method | Credits | Notes |');
        lines.push('|--------|---------|-------|');
        for (const [method, info] of Object.entries(CREDIT_COSTS)) {
          lines.push(`| ${method} | ${info.cost} | ${info.notes || ''} |`);
        }
      }

      lines.push('', '## Best Practices', '');
      lines.push('1. **Implement exponential backoff** on 429 errors');
      lines.push('2. **Use batch requests** (getMultipleAccounts vs multiple getAccountInfo)');
      lines.push('3. **Cache responses** where appropriate (blockhash valid ~60-90s)');
      lines.push('4. **Monitor usage** in dashboard to avoid surprises');
      lines.push('5. **Spread requests** evenly rather than bursting');

      return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
    }
  );

  // Tool 2: getSenderInfo
  server.tool(
    'getSenderInfo',
    'Get information about Helius Sender for transaction submission. Covers Sender vs Jito direct, SWQoS routing, tips, landing latency, and best practices for fast transaction landing.',
    {},
    async () => {
      const lines = [
        '# Helius Sender Guide',
        '',
        '## What is Sender?',
        'Sender is Helius\'s optimized transaction submission service that uses Stake-Weighted Quality of Service (SWQoS) for faster, more reliable transaction landing.',
        '',
        '## Key Features',
        '- **SWQoS Routing**: Uses staked connections for priority access to leaders',
        '- **Jito Integration**: Bundles transactions with Jito for MEV protection',
        '- **No Extra Cost**: Included in all paid plans',
        '- **No CORS Issues**: Use `Content-Type: text/plain` from browsers',
        '',
        '## Sender vs Direct Jito',
        '',
        '| Feature | Helius Sender | Direct Jito |',
        '|---------|---------------|-------------|',
        '| SWQoS | Included | No |',
        '| Jito Bundles | Auto-bundled | Manual |',
        '| Tips | Helius handles | You manage |',
        '| Setup | Use Helius RPC | Separate integration |',
        '',
        '## Tips & Fees',
        '',
        '### Default Tip',
        '- **Amount**: ~0.0002 SOL (200,000 lamports)',
        '- **Recipient**: Helius tip account (re-bundled with Jito)',
        '- **Sufficient for most cases**: Yes, works for normal transactions',
        '',
        '### Priority Fees',
        '- Add `ComputeBudgetProgram.setComputeUnitPrice()` for higher priority',
        '- Higher fees = better chance of landing in competitive slots',
        '- Use `getPriorityFeeEstimate` to get recommended fees',
        '',
        '## Expected Latency',
        '',
        '| Metric | Typical Range |',
        '|--------|---------------|',
        '| Send to Helius | ~100ms |',
        '| Landing (confirmation) | 200-700ms |',
        '| Total end-to-end | 300-800ms |',
        '',
        '**Note**: Latency varies with:',
        '- Leader geography (closer = faster)',
        '- Network congestion',
        '- Priority fee amount',
        '- Transaction complexity',
        '',
        '## Usage',
        '',
        '### Standard RPC',
        '```',
        'POST https://mainnet.helius-rpc.com/?api-key=<KEY>',
        'Content-Type: application/json',
        '',
        '{"jsonrpc":"2.0","id":1,"method":"sendTransaction","params":["<base64-tx>"]}',
        '```',
        '',
        '### Browser (No CORS)',
        '```',
        'POST https://mainnet.helius-rpc.com/?api-key=<KEY>',
        'Content-Type: text/plain',
        '',
        '<base64-tx>',
        '```',
        '',
        '## Limitations',
        '- **No batch submit**: Cannot send multiple transactions in one request',
        '- **No durable nonce batching**: Each tx needs its own nonce account',
        '- **No rebates**: Tips are not refunded on backrun/bribe endpoints',
        '',
        '## Best Practices',
        '',
        '1. **Use fresh blockhash**: Get blockhash right before signing (valid ~60-90s)',
        '2. **Rebroadcast**: Resend every 200-500ms until confirmed or expired',
        '3. **Set skipPreflight: false** in dev to catch errors early',
        '4. **Monitor with Laserstream**: Use for accurate landing latency measurement',
        '5. **Use priority fees**: Especially during congestion',
        '',
        '## Measuring Landing Latency',
        'Use **block index position**, not account update timing:',
        '- Subscribe to blocks via Laserstream/gRPC',
        '- Note slot and transaction index when your tx appears',
        '- Compare to when you sent',
      ];

      return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
    }
  );

  // Tool 3: getWebhookGuide
  server.tool(
    'getWebhookGuide',
    'Get detailed information about Helius webhooks including delivery guarantees, latency expectations, configuration options, and troubleshooting common issues.',
    {
      topic: z
        .enum(['overview', 'delivery', 'configuration', 'troubleshooting', 'all'])
        .optional()
        .default('all')
        .describe('Specific topic to focus on'),
    },
    async ({ topic }) => {
      const lines: string[] = [];

      const showOverview = topic === 'all' || topic === 'overview';
      const showDelivery = topic === 'all' || topic === 'delivery';
      const showConfig = topic === 'all' || topic === 'configuration';
      const showTroubleshooting = topic === 'all' || topic === 'troubleshooting';

      lines.push('# Helius Webhooks Guide', '');

      if (showOverview) {
        lines.push('## Overview', '');
        lines.push('Webhooks push blockchain events to your endpoint in real-time.', '');
        lines.push('### Webhook Types');
        lines.push('- **Enhanced**: Parsed, human-readable events (transfers, swaps, NFT sales)');
        lines.push('- **Raw**: Unparsed transaction data');
        lines.push('- **Discord**: Formatted for Discord channels');
        lines.push('');
        lines.push('### Transaction Types');
        lines.push('`TRANSFER`, `SWAP`, `NFT_SALE`, `NFT_MINT`, `NFT_LISTING`, `BURN`, `ANY`');
        lines.push('');
      }

      if (showDelivery) {
        lines.push('## Delivery Guarantees', '');
        lines.push('### Latency');
        lines.push('- **Enhanced webhooks**: ~15-20 slots (~6-8 seconds) from on-chain confirmation');
        lines.push('- **Raw webhooks**: Slightly faster but unparsed');
        lines.push('');
        lines.push('### Commitment Level');
        lines.push('- Webhooks fire on **confirmed** commitment by default');
        lines.push('- Not processed (too early) or finalized (too slow)');
        lines.push('');
        lines.push('### Retry Policy');
        lines.push('- Helius retries failed deliveries with exponential backoff');
        lines.push('- Your endpoint should return 2xx within timeout');
        lines.push('- After retries exhausted, event may be dropped');
        lines.push('');
        lines.push('### Ordering');
        lines.push('- Events are generally in order but **not guaranteed**');
        lines.push('- Use transaction signature + slot for deduplication');
        lines.push('');
      }

      if (showConfig) {
        lines.push('## Configuration', '');
        lines.push('### Account Addresses');
        lines.push('- Add addresses to monitor (up to limits per plan)');
        lines.push('- New addresses may take a few seconds to activate');
        lines.push('');
        lines.push('### Transaction Types');
        lines.push('- Use `ANY` to receive all transaction types');
        lines.push('- Or specify: `TRANSFER`, `SWAP`, `NFT_SALE`, etc.');
        lines.push('');
        lines.push('### Webhook URL');
        lines.push('- Must be HTTPS');
        lines.push('- Must respond within timeout (typically 30s)');
        lines.push('- Return 2xx for success');
        lines.push('');
      }

      if (showTroubleshooting) {
        lines.push('## Troubleshooting', '');
        lines.push('### Missing Events');
        lines.push('1. **Check transaction type filter**: Use `ANY` if unsure');
        lines.push('2. **Verify address is added**: Check webhook config');
        lines.push('3. **New ATA issue**: First transfer to new ATA may be missed');
        lines.push('4. **Endpoint timeout**: Ensure fast response (<30s)');
        lines.push('5. **Check webhook health**: Look for POST timeouts in your logs');
        lines.push('');
        lines.push('### Duplicate Events');
        lines.push('- Use transaction signature as idempotency key');
        lines.push('- Store processed signatures to dedupe');
        lines.push('');
        lines.push('### Delayed Events');
        lines.push('- Normal latency is ~15-20 slots');
        lines.push('- Check status.helius.dev for incidents');
        lines.push('- Consider Enhanced WebSockets or Laserstream for lower latency');
        lines.push('');
        lines.push('### ATA Creation Edge Case');
        lines.push('- When a token transfer creates a new ATA in the same tx:');
        lines.push('  - Raw webhooks: May only fire if dest ATA pre-exists');
        lines.push('  - Enhanced webhooks: Should handle but verify');
        lines.push('- Workaround: Also subscribe to the token mint');
        lines.push('');
      }

      return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
    }
  );

  // Tool 4: troubleshootError
  server.tool(
    'troubleshootError',
    'Get detailed explanation and fixes for common Helius/Solana RPC error codes. Covers JSON-RPC errors, HTTP status codes, and WebSocket close codes.',
    {
      errorCode: z
        .string()
        .describe('Error code to troubleshoot (e.g., "-32603", "429", "1006")'),
    },
    async ({ errorCode }) => {
      const lines: string[] = [];
      const code = errorCode.replace(/^-/, '-'); // Normalize

      const error = ERROR_CODES[code];

      if (error) {
        lines.push(`# Error ${code}: ${error.meaning}`, '');
        lines.push('## Possible Causes');
        for (const cause of error.causes) {
          lines.push(`- ${cause}`);
        }
        lines.push('', '## How to Fix');
        for (const fix of error.fixes) {
          lines.push(`- ${fix}`);
        }
      } else {
        lines.push(`# Error ${code}`, '');
        lines.push('This error code is not in our database.', '');
        lines.push('## General Troubleshooting');
        lines.push('1. Check https://status.helius.dev for incidents');
        lines.push('2. Verify your API key is valid');
        lines.push('3. Check your plan limits in dashboard');
        lines.push('4. Try the request with curl to isolate client issues');
        lines.push('5. Contact support with request ID if persistent');
      }

      lines.push('', '## Common Error Codes Reference', '');
      lines.push('| Code | Meaning |');
      lines.push('|------|---------|');
      for (const [c, e] of Object.entries(ERROR_CODES)) {
        lines.push(`| ${c} | ${e.meaning} |`);
      }

      return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
    }
  );

  // Tool 5: getLatencyComparison
  server.tool(
    'getLatencyComparison',
    'Compare latency across Helius products: Standard WebSockets, Enhanced WebSockets, Laserstream (gRPC), and Shred Stream. Helps choose the right product for latency-sensitive applications.',
    {},
    async () => {
      const lines = [
        '# Helius Latency Comparison',
        '',
        '## Product Latency Hierarchy (fastest to slowest)',
        '',
        '```',
        'Shred Stream (~5-10ms ahead of Laserstream)',
        '    ↓',
        'Laserstream gRPC (~50-100ms from block production)',
        '    ↓',
        'Enhanced WebSockets (1.5-2x faster than Standard)',
        '    ↓',
        'Standard WebSockets (~1-2 seconds)',
        '    ↓',
        'Webhooks (~15-20 slots / 6-8 seconds)',
        '```',
        '',
        '## Detailed Comparison',
        '',
        '| Product | Typical Latency | Commitment | Plan Required |',
        '|---------|-----------------|------------|---------------|',
        '| Shred Stream | 5-10ms faster than LS | Pre-processed | Custom |',
        '| Laserstream | 50-100ms | Processed/Confirmed | Professional ($999) |',
        '| Enhanced WS | ~500ms-1s | Processed | Business ($499) |',
        '| Standard WS | 1-2s | Confirmed | Free |',
        '| Webhooks | 6-8s | Confirmed | Free |',
        '',
        '## Product Details',
        '',
        '### Shred Stream',
        '- **What**: Raw UDP shreds or pre-deshredded transactions',
        '- **Latency**: 5-10ms faster than Laserstream',
        '- **Cost**: ~$6K/IP/month',
        '- **Best for**: Ultra-low-latency trading, MEV',
        '',
        '### Laserstream (gRPC)',
        '- **What**: gRPC streaming with transaction/account/block subscriptions',
        '- **Latency**: ~50-100ms from block production',
        '- **Features**:',
        '  - Up to 50,000 address filters',
        '  - 24h historical replay',
        '  - Processed/Confirmed/Finalized commitment',
        '- **Plan access**:',
        '  - Developer: Devnet only',
        '  - Professional: Full mainnet + devnet',
        '',
        '### Enhanced WebSockets',
        '- **What**: Optimized WebSocket streams (transactionSubscribe, accountSubscribe)',
        '- **Latency**: 1.5-2x faster than standard',
        '- **Features**:',
        '  - Up to 50,000 address filters',
        '  - 10-minute inactivity timeout (ping every 30-60s)',
        '  - 100 connections (Business/Professional)',
        '- **Plan access**: Business ($499) and above',
        '',
        '### Standard WebSockets',
        '- **What**: Solana-native WebSocket subscriptions',
        '- **Latency**: 1-2 seconds',
        '- **Commitment**: Confirmed only (no processed on free)',
        '- **Connections**: 5 (Free), 150 (Developer), 250 (Business+)',
        '',
        '### Webhooks',
        '- **What**: HTTP POST to your endpoint on events',
        '- **Latency**: ~15-20 slots (6-8 seconds)',
        '- **Best for**: Non-latency-critical notifications',
        '',
        '## Choosing the Right Product',
        '',
        '| Use Case | Recommended | Why |',
        '|----------|-------------|-----|',
        '| Copy trading | Laserstream | Lowest latency for tx detection |',
        '| MEV/Arbitrage | Shred Stream | Pre-block transaction visibility |',
        '| Real-time UI | Enhanced WS | Good balance of speed and cost |',
        '| Notifications | Webhooks | Simple, no connection management |',
        '| Development | Standard WS | Free, good enough for testing |',
        '',
        '## Measuring Latency',
        '',
        '### Correct Method',
        '1. Subscribe to blocks via Laserstream/gRPC',
        '2. Note slot number and transaction index when your tx appears',
        '3. Compare to when you submitted',
        '',
        '### Incorrect Method',
        '- Using account update timing (varies by indexer, not true landing time)',
        '- Comparing different endpoints with different commitments',
        '',
        '## Regional Considerations',
        '',
        '- **Closest region = lowest latency**',
        '- Available regions: US (multiple), EU (FRA, AMS), Asia (SG, TYO)',
        '- Leader schedule affects latency (leaders rotate every ~400ms)',
      ];

      return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
    }
  );

  // Tool 6: getPumpFunGuide
  server.tool(
    'getPumpFunGuide',
    'Guide for working with pump.fun tokens on Helius. Covers why getAssetsByCreator does not work, how to track migrations/graduates, and best practices for pump.fun token queries.',
    {},
    async () => {
      const lines = [
        '# Pump.fun Tokens Guide',
        '',
        '## Why getAssetsByCreator Doesn\'t Work',
        '',
        'When you call `getAssetsByCreator` with a pump.fun deployer wallet, it returns empty.',
        '',
        '**Reason**: DAS API\'s "creator" field refers to **Metaplex creators** metadata, not the wallet that deployed the token.',
        '',
        '- Pump.fun tokens don\'t use Metaplex creators array',
        '- The deployer wallet is not stored in the same way',
        '- DAS cannot index pump.fun deployers as "creators"',
        '',
        '## How to Find Pump.fun Tokens',
        '',
        '### Option 1: Listen to Migration Events',
        '```',
        '// Subscribe to pump.fun migration program',
        'Program ID: 6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P',
        '',
        '// Filter for "migrate" instruction',
        '// This fires when a token graduates from bonding curve',
        '```',
        '',
        '### Option 2: Query by Mint/Update Authority',
        '',
        'Instead of creator, try:',
        '- `getAsset` with the specific mint address',
        '- Filter by update authority or freeze authority',
        '- Search by token metadata name/symbol patterns',
        '',
        '### Option 3: Historical Backfill',
        '',
        'For historical graduated tokens:',
        '```',
        '1. Query migration program transaction history',
        '2. Parse the "migrate" instruction logs',
        '3. Extract token mint addresses',
        '4. Use getAsset to get full token details',
        '```',
        '',
        '## Tracking Migrations (Graduates)',
        '',
        '### What is a Migration/Graduate?',
        'When a pump.fun token completes its bonding curve, it "graduates" and migrates to Raydium.',
        '',
        '### Migration Program',
        '```',
        'Program: 6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P',
        'Instruction: migrate',
        '```',
        '',
        '### Real-time Migration Tracking',
        '```typescript',
        '// Using Laserstream/gRPC',
        'subscribe({',
        '  transactions: {',
        '    accountInclude: ["6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P"],',
        '  }',
        '});',
        '',
        '// Or Enhanced WebSockets',
        'transactionSubscribe({',
        '  accountInclude: ["6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P"],',
        '});',
        '```',
        '',
        '### Historical Migrations',
        '```typescript',
        '// Get past migrations',
        'const signatures = await connection.getSignaturesForAddress(',
        '  new PublicKey("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P"),',
        '  { limit: 1000 }',
        ');',
        '',
        '// Parse each transaction for migrate instruction',
        'for (const sig of signatures) {',
        '  const tx = await parseTransactions([sig.signature]);',
        '  // Extract token mint from parsed data',
        '}',
        '```',
        '',
        '## Common Pump.fun Queries',
        '',
        '### Get Token Details',
        '```typescript',
        '// If you have the mint address',
        'const asset = await helius.getAsset({ id: mintAddress });',
        '```',
        '',
        '### Check if Token is Graduated',
        '```typescript',
        '// Graduated tokens will have Raydium LP',
        '// Check for AMM/CPMM pool with the token',
        '```',
        '',
        '### Get Token Holders',
        '```typescript',
        'const holders = await helius.getTokenAccounts({',
        '  mint: mintAddress,',
        '  limit: 100,',
        '});',
        '```',
        '',
        '## Feature Request Status',
        '',
        'Helius is aware of demand for:',
        '- Native pump.fun migration filter in Events API',
        '- Historical graduates backfill endpoint',
        '- Creator-by-deployer-wallet queries',
        '',
        'Check docs.helius.dev for updates.',
      ];

      return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
    }
  );
}
