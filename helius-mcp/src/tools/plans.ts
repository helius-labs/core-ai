import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

// Helius plan details (as of 2024)
const HELIUS_PLANS = {
  free: {
    name: 'Free',
    price: '$0/month',
    credits: '1M/month',
    additionalCredits: 'N/A',
    rateLimit: {
      rpc: '10 RPS',
      sendTransaction: '1/sec',
      getProgramAccounts: '5/sec',
      das: '2/sec',
    },
    connections: {
      websocket: 5,
      enhancedWebsocket: 0,
    },
    features: {
      webhooks: true,
      standardWebSockets: true,
      enhancedWebSockets: false,
      laserstream: false,
      stakedConnections: true,
      archivalData: true,
    },
    support: 'Community (Discord)',
    sla: 'N/A',
  },
  developer: {
    name: 'Developer',
    price: '$49/month',
    credits: '10M/month',
    additionalCredits: '$5 per million',
    rateLimit: {
      rpc: '50 RPS',
      sendTransaction: '5/sec',
      getProgramAccounts: '25/sec',
      das: '10/sec',
    },
    connections: {
      websocket: 150,
      enhancedWebsocket: 0,
    },
    features: {
      webhooks: true,
      standardWebSockets: true,
      enhancedWebSockets: false,
      laserstream: 'Devnet only',
      stakedConnections: true,
      archivalData: true,
    },
    support: 'Chat support',
    sla: '24-hour response',
  },
  business: {
    name: 'Business',
    price: '$499/month',
    credits: '100M/month',
    additionalCredits: '$5 per million',
    rateLimit: {
      rpc: '200 RPS',
      sendTransaction: '50/sec',
      getProgramAccounts: '50/sec',
      das: '50/sec',
    },
    connections: {
      websocket: 250,
      enhancedWebsocket: 100,
    },
    features: {
      webhooks: true,
      standardWebSockets: true,
      enhancedWebSockets: true,
      laserstream: 'Devnet only',
      stakedConnections: true,
      archivalData: true,
    },
    support: 'Priority chat',
    sla: '12-hour response',
  },
  professional: {
    name: 'Professional',
    price: '$999/month',
    credits: '200M/month',
    additionalCredits: '$5 per million',
    rateLimit: {
      rpc: '500 RPS (+100 RPS for $100/mo)',
      sendTransaction: '100/sec',
      getProgramAccounts: '75/sec',
      das: '100/sec',
    },
    connections: {
      websocket: 250,
      enhancedWebsocket: 100,
    },
    features: {
      webhooks: true,
      standardWebSockets: true,
      enhancedWebSockets: true,
      laserstream: 'Full access (mainnet + devnet, data add-ons $500+/mo)',
      stakedConnections: true,
      archivalData: true,
    },
    support: 'Dedicated Slack + Telegram',
    sla: '8-hour response',
  },
};

type PlanKey = keyof typeof HELIUS_PLANS;

function formatPlanDetails(planKey: PlanKey): string {
  const plan = HELIUS_PLANS[planKey];
  const lines = [
    `## ${plan.name} Plan`,
    '',
    `**Price:** ${plan.price}`,
    `**Credits:** ${plan.credits}`,
    `**Additional Credits:** ${plan.additionalCredits}`,
    '',
    '### Rate Limits',
    `- RPC Requests: ${plan.rateLimit.rpc}`,
    `- sendTransaction: ${plan.rateLimit.sendTransaction}`,
    `- getProgramAccounts: ${plan.rateLimit.getProgramAccounts}`,
    `- DAS Requests: ${plan.rateLimit.das}`,
    '',
    '### Connection Limits',
    `- Standard WebSocket Connections: ${plan.connections.websocket}`,
    `- Enhanced WebSocket Connections: ${plan.connections.enhancedWebsocket}`,
    '',
    '### Features',
    `- Webhooks: ${plan.features.webhooks ? 'Yes' : 'No'}`,
    `- Standard WebSockets: ${plan.features.standardWebSockets ? 'Yes' : 'No'}`,
    `- Enhanced WebSockets: ${typeof plan.features.enhancedWebSockets === 'string' ? plan.features.enhancedWebSockets : plan.features.enhancedWebSockets ? 'Yes' : 'No'}`,
    `- Laserstream: ${typeof plan.features.laserstream === 'string' ? plan.features.laserstream : plan.features.laserstream ? 'Yes' : 'No'}`,
    `- Staked Connections: ${plan.features.stakedConnections ? 'Yes' : 'No'}`,
    `- Archival Data: ${plan.features.archivalData ? 'Yes' : 'No'}`,
  ];

  if ('soc2Compliance' in plan.features) {
    lines.push(`- SOC 2 Compliance: Yes`);
  }
  if ('customInfrastructure' in plan.features) {
    lines.push(`- Custom Infrastructure: Yes`);
  }

  lines.push('', '### Support');
  lines.push(`- Channel: ${plan.support}`);
  lines.push(`- SLA: ${plan.sla}`);

  return lines.join('\n');
}

export function registerPlanTools(server: McpServer) {
  server.tool(
    'getHeliusPlanInfo',
    'Get detailed Helius plan information including pricing, credits, rate limits, and feature availability. Shows what features are available on each tier (Free, Developer, Business, Professional). Useful for understanding WebSocket limits, Laserstream access, and API rate limits per plan.',
    {
      plan: z.enum(['free', 'developer', 'business', 'professional', 'all']).optional().default('all').describe('Specific plan to show details for, or "all" for comparison')
    },
    async ({ plan }) => {
      try {
        if (plan === 'all') {
          const lines = [
            '# Helius Plans Overview',
            '',
            '| Feature | Free | Developer | Business | Professional |',
            '|---------|------|-----------|----------|--------------|',
            '| **Price** | $0/mo | $49/mo | $499/mo | $999/mo |',
            '| **Credits** | 1M | 10M | 100M | 200M |',
            '| **RPC RPS** | 10 | 50 | 200 | 500 |',
            '| **sendTransaction** | 1/s | 5/s | 50/s | 100/s |',
            '| **DAS Requests** | 2/s | 10/s | 50/s | 100/s |',
            '| **WS Connections** | 5 | 150 | 250 | 250 |',
            '| **Enhanced WS** | No | No | Yes (100) | Yes (100) |',
            '| **Laserstream** | No | Devnet | Devnet | Full |',
            '| **Support SLA** | — | 24hr | 12hr | 8hr |',
            '',
            '---',
            '',
            '## Key Differences',
            '',
            '### WebSocket Connection Limits',
            '- **Free:** 5 simultaneous connections',
            '- **Developer:** 150 connections',
            '- **Business/Professional:** 250 standard, 100 enhanced each',
            '',
            '### Enhanced WebSockets',
            '- **Available on:** Business, Professional',
            '- **Connection limit:** 100 (Business/Pro)',
            '- **Speed:** 1.5-2x faster than standard WebSockets',
            '- **Filtering:** Up to 50,000 addresses per filter',
            '- **Subscriptions:** transactionSubscribe, accountSubscribe',
            '- **Timeout:** 10 min inactivity (ping every 30-60s)',
            '- **Cost:** 1 credit to open, 3 credits per 0.1 MB streamed',
            '',
            '### Laserstream (gRPC)',
            '- **Developer/Business:** Devnet only',
            '- **Professional:** Full access (mainnet + devnet)',
            '- **Data add-ons:** Starting at $500/mo for Professional',
            '- **Features:** 24h historical replay, lowest latency',
            '',
            '### Credit Costs (from docs)',
            '- **0 credits**: Helius Sender',
            '- **1 credit**: Standard RPC, sendTransaction, Priority Fee API, webhook events',
            '- **3 credits**: per 0.1 MB streamed (LaserStream, Enhanced WS)',
            '- **10 credits**: getProgramAccounts, historical data (getBlock, getTransaction, etc.), DAS API',
            '- **100 credits**: Enhanced Transactions, Wallet API, getValidityProof (ZK), webhook management',
            '- **Additional credits**: $5 per million (all paid plans)',
            '',
            '**Docs:** https://www.helius.dev/pricing',
          ];
          return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
        }

        const planDetails = formatPlanDetails(plan as PlanKey);
        return { content: [{ type: 'text' as const, text: planDetails }] };
      } catch (err: unknown) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: 'text' as const, text: `Error: ${errorMsg}` }], isError: true };
      }
    }
  );

  server.tool(
    'compareHeliusPlans',
    'Compare specific Helius plans side-by-side for a specific feature category (rate limits, features, connections, or pricing).',
    {
      category: z.enum(['rates', 'features', 'connections', 'pricing', 'support']).describe('Category to compare'),
      plans: z.array(z.enum(['free', 'developer', 'business', 'professional'])).optional().describe('Plans to compare (default: all)')
    },
    async ({ category, plans }) => {
      const plansToCompare = plans || ['free', 'developer', 'business', 'professional'];

      const lines: string[] = [];

      switch (category) {
        case 'rates':
          lines.push('# Rate Limits Comparison', '');
          lines.push('| Plan | RPC RPS | sendTx | getProgramAccounts | DAS |');
          lines.push('|------|---------|--------|-------------------|-----|');
          for (const p of plansToCompare) {
            const plan = HELIUS_PLANS[p as PlanKey];
            lines.push(`| ${plan.name} | ${plan.rateLimit.rpc} | ${plan.rateLimit.sendTransaction} | ${plan.rateLimit.getProgramAccounts} | ${plan.rateLimit.das} |`);
          }
          break;

        case 'features':
          lines.push('# Features Comparison', '');
          lines.push('| Plan | Enhanced WS | Laserstream | Staked | Archival |');
          lines.push('|------|-------------|-------------|--------|----------|');
          for (const p of plansToCompare) {
            const plan = HELIUS_PLANS[p as PlanKey];
            const ews = typeof plan.features.enhancedWebSockets === 'string' ? plan.features.enhancedWebSockets : plan.features.enhancedWebSockets ? 'Yes' : 'No';
            const ls = typeof plan.features.laserstream === 'string' ? plan.features.laserstream : plan.features.laserstream ? 'Yes' : 'No';
            lines.push(`| ${plan.name} | ${ews} | ${ls} | Yes | Yes |`);
          }
          break;

        case 'connections':
          lines.push('# Connection Limits Comparison', '');
          lines.push('| Plan | Standard WS | Enhanced WS |');
          lines.push('|------|-------------|-------------|');
          for (const p of plansToCompare) {
            const plan = HELIUS_PLANS[p as PlanKey];
            lines.push(`| ${plan.name} | ${plan.connections.websocket} | ${plan.connections.enhancedWebsocket} |`);
          }
          lines.push('', '**Notes:**');
          lines.push('- Enhanced WS requires Business+ plan');
          lines.push('- Opening a connection costs 1 credit');
          lines.push('- Enhanced WS data: 3 credits per 0.1 MB streamed');
          lines.push('- 10-minute inactivity timeout (ping every 30-60s)');
          break;

        case 'pricing':
          lines.push('# Pricing Comparison', '');
          lines.push('| Plan | Price | Credits | Extra Credits |');
          lines.push('|------|-------|---------|---------------|');
          for (const p of plansToCompare) {
            const plan = HELIUS_PLANS[p as PlanKey];
            lines.push(`| ${plan.name} | ${plan.price} | ${plan.credits} | ${plan.additionalCredits} |`);
          }
          break;

        case 'support':
          lines.push('# Support Comparison', '');
          lines.push('| Plan | Channel | SLA |');
          lines.push('|------|---------|-----|');
          for (const p of plansToCompare) {
            const plan = HELIUS_PLANS[p as PlanKey];
            lines.push(`| ${plan.name} | ${plan.support} | ${plan.sla} |`);
          }
          break;
      }

      return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
    }
  );
}
