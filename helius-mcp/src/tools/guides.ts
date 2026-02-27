import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { fetchDoc, fetchDocs } from '../utils/docs.js';

// Error codes and their meanings — no canonical llms.txt equivalent
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
  // Tool 1: getRateLimitInfo — fetches live billing docs
  server.tool(
    'getRateLimitInfo',
    'BEST FOR: credit costs and rate limits per API method. PREFER getHeliusPlanInfo for plan pricing/features overview. Get official Helius rate limits and credit costs per API method. Fetches live from the billing documentation so values are always accurate.',
    {},
    async () => {
      try {
        const content = await fetchDoc('billing');
        const result = [
          '# Helius Rate Limits & Credits (Official)',
          '',
          content,
          '',
          '---',
          'Source: https://www.helius.dev/docs/billing (fetched live)',
        ].join('\n');
        return { content: [{ type: 'text' as const, text: result }] };
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: 'text' as const, text: `Error fetching rate limit info: ${errorMsg}` }],
          isError: true,
        };
      }
    }
  );

  // Tool 2: getSenderInfo — fetches live sender docs
  server.tool(
    'getSenderInfo',
    'Get information about Helius Sender for transaction submission. Fetches live from official documentation covering SWQoS routing, tips, latency, and best practices.',
    {},
    async () => {
      try {
        const content = await fetchDoc('sender');
        const result = [
          '# Helius Sender (Official)',
          '',
          content,
          '',
          '---',
          'Source: https://www.helius.dev/docs (fetched live)',
        ].join('\n');
        return { content: [{ type: 'text' as const, text: result }] };
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: 'text' as const, text: `Error fetching Sender info: ${errorMsg}` }],
          isError: true,
        };
      }
    }
  );

  // Tool 3: getWebhookGuide — fetches live webhooks docs
  server.tool(
    'getWebhookGuide',
    'Get official Helius webhook documentation including delivery guarantees, latency, configuration, and troubleshooting. Fetches live from documentation.',
    {},
    async () => {
      try {
        const content = await fetchDoc('webhooks');
        const result = [
          '# Helius Webhooks (Official)',
          '',
          content,
          '',
          '---',
          'Source: https://www.helius.dev/docs (fetched live)',
        ].join('\n');
        return { content: [{ type: 'text' as const, text: result }] };
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: 'text' as const, text: `Error fetching webhook guide: ${errorMsg}` }],
          isError: true,
        };
      }
    }
  );

  // Tool 4: troubleshootError — kept hardcoded (no llms.txt equivalent)
  server.tool(
    'troubleshootError',
    'BEST FOR: diagnosing specific error codes. Always use this first when the user encounters an error, before attempting manual diagnosis. Get detailed explanation and fixes for common Helius/Solana RPC error codes. Covers JSON-RPC errors, HTTP status codes, and WebSocket close codes.',
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

  // Tool 5: getLatencyComparison — fetches live docs for all streaming products
  server.tool(
    'getLatencyComparison',
    'Compare latency across Helius streaming products: Standard WebSockets, Enhanced WebSockets, Laserstream (gRPC), and Shred Stream. Fetches live from official documentation.',
    {},
    async () => {
      try {
        const docs = await fetchDocs(['laserstream', 'enhanced-websockets', 'shred-delivery']);
        const sections: string[] = [
          '# Helius Streaming Products: Latency Comparison (Official)',
          '',
          '> The following is fetched live from official Helius documentation.',
          '',
        ];

        const labels: Record<string, string> = {
          laserstream: 'LaserStream (gRPC)',
          'enhanced-websockets': 'Enhanced WebSockets',
          'shred-delivery': 'Shred Delivery',
        };

        for (const [key, content] of docs.entries()) {
          sections.push(`## ${labels[key] ?? key}`, '', content, '', '---', '');
        }

        sections.push('Source: https://www.helius.dev/docs (fetched live)');

        return { content: [{ type: 'text' as const, text: sections.join('\n') }] };
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: 'text' as const, text: `Error fetching latency comparison: ${errorMsg}` }],
          isError: true,
        };
      }
    }
  );

  // Tool 6: getPumpFunGuide — kept hardcoded (no llms.txt equivalent)
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
