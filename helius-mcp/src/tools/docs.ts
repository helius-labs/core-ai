import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { fetchDoc, fetchDocs, getDocsIndex, extractSections, truncateDoc, DOCS_INDEX } from '../utils/docs.js';

function getDocHeadings(content: string): string[] {
  return Array.from(content.matchAll(/^#{1,3}\s+(.+)$/gm))
    .map((match) => match[1].trim())
    .filter(Boolean)
    .slice(0, 12);
}

export function registerDocsTools(server: McpServer) {
  /**
   * Lookup Helius documentation - fetches official docs for accurate information
   */
  server.tool(
    'lookupHeliusDocs',
    'BEST FOR: API documentation and technical details. NOT for pricing (use getHeliusPlanInfo) or errors (use troubleshootError). Fetch official Helius documentation by topic. Use `section` parameter to fetch only relevant sections and save tokens.',
    {
      topic: z
        .enum([
          'overview',
          'agents',
          'billing',
          'das',
          'rpc',
          'websocket',
          'enhanced-websockets',
          'webhooks',
          'enhanced-transactions',
          'sender',
          'priority-fee',
          'laserstream',
          'wallet-api',
          'zk-compression',
          'dedicated-nodes',
          'shred-delivery',
        ])
        .optional()
        .describe('Documentation topic to fetch'),
      section: z
        .string()
        .optional()
        .describe(
          'Optional: specific section to extract (e.g., "credits", "rate limits", "parameters"). If provided, returns only matching sections.'
        ),
      query: z
        .string()
        .optional()
        .describe('Freeform query — used to infer topic if topic is not provided'),
    },
    async ({ topic: rawTopic, section, query }) => {
      const VALID_TOPICS = [
        'overview', 'agents', 'billing', 'das', 'rpc', 'websocket',
        'enhanced-websockets', 'webhooks', 'enhanced-transactions', 'sender',
        'priority-fee', 'laserstream', 'wallet-api', 'zk-compression',
        'dedicated-nodes', 'shred-delivery',
      ] as const;

      let topic = rawTopic;
      if (!topic && query) {
        const q = query.toLowerCase();
        topic = VALID_TOPICS.find((t) => q.includes(t))
          ?? (q.includes('grpc') || q.includes('shred') && q.includes('stream') ? 'laserstream'
          : q.includes('nft') || q.includes('asset') ? 'das'
          : q.includes('webhook') ? 'webhooks'
          : q.includes('fee') || q.includes('priority') ? 'priority-fee'
          : q.includes('wallet') ? 'wallet-api'
          : q.includes('compress') ? 'zk-compression'
          : q.includes('websocket') || q.includes('ws') ? 'enhanced-websockets'
          : q.includes('transaction') || q.includes('parsed') ? 'enhanced-transactions'
          : q.includes('send') || q.includes('submit') ? 'sender'
          : undefined);
      }

      if (!topic) {
        const topicList = VALID_TOPICS.map((t) => `\`${t}\``).join(', ');
        return {
          content: [{
            type: 'text' as const,
            text: `Missing required parameter: topic. Valid topics: ${topicList}`,
          }],
          isError: true,
        };
      }
      try {
        const content = await fetchDoc(topic);

        // If a section filter is provided, extract relevant parts
        if (section) {
          const extracted = extractSections(content, section, { includeLooseMatches: true });

          if (extracted) {
            const result = [
              `# Helius Docs: ${topic} (filtered by "${section}")`,
              '',
              extracted,
              '',
              '---',
              `Source: https://www.helius.dev/docs (${topic})`,
            ].join('\n');
            return { content: [{ type: 'text' as const, text: result }] };
          } else {
            return {
              content: [
                {
                  type: 'text' as const,
                  text: [
                    `No sections matching "${section}" were found in \`${topic}\` docs.`,
                    '',
                    'Available sections:',
                    ...getDocHeadings(content).map((heading) => `- ${heading}`),
                    '',
                    'Tip: retry with a more specific section filter or omit `section` to receive the default truncated document summary.',
                  ].join('\n'),
                },
              ],
            };
          }
        }

        // Return full documentation (truncated to save tokens)
        const result = [
          `# Helius Docs: ${topic}`,
          '',
          truncateDoc(content),
          '',
          '---',
          `Source: https://www.helius.dev/docs`,
          '',
          '*Tip: Use the `section` parameter (e.g., section: "rate limits") to fetch only what you need and save tokens.*',
        ].join('\n');

        return { content: [{ type: 'text' as const, text: result }] };
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        return {
          content: [
            {
              type: 'text' as const,
              text: `Error fetching docs: ${errorMsg}\n\nTry again or check https://www.helius.dev/docs directly.`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  /**
   * List available documentation topics
   */
  server.tool(
    'listHeliusDocTopics',
    'List all available Helius documentation topics that can be fetched with lookupHeliusDocs.',
    {},
    async () => {
      const index = getDocsIndex();
      const lines = [
        '# Available Helius Documentation Topics',
        '',
        'Use `lookupHeliusDocs` with any of these topics. Add `section` to filter.',
        '',
        '| Topic | Description |',
        '|-------|-------------|',
        ...index.map((doc) => `| \`${doc.key}\` | ${doc.description} |`),
      ];

      return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
    }
  );

  /**
   * Get credits information from official docs
   */
  server.tool(
    'getHeliusCreditsInfo',
    'BEST FOR: credit cost lookup table. PREFER getRateLimitInfo for per-method rate limits, getHeliusPlanInfo for plan pricing. Get official Helius credit costs from documentation.',
    {},
    async () => {
      try {
        const content = await fetchDoc('billing');
        const credits = extractSections(content, 'credits', { includeLooseMatches: true });

        const result = [
          '# Helius Credit Costs (Official)',
          '',
          'Source: https://www.helius.dev/docs/billing (fetched live)',
          '',
          credits || 'Credits section not found in billing docs.',
        ].join('\n');

        return { content: [{ type: 'text' as const, text: result }] };
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: 'text' as const, text: `Error fetching credits info: ${errorMsg}` }],
          isError: true,
        };
      }
    }
  );
}
