import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { fetchDoc, fetchDocs, getDocsIndex, DOCS_INDEX } from '../utils/docs.js';

export function registerDocsTools(server: McpServer) {
  /**
   * Lookup Helius documentation - fetches official docs for accurate information
   */
  server.tool(
    'lookupHeliusDocs',
    'Fetch official Helius documentation for accurate, up-to-date information. Use this when you need precise details about APIs, pricing, rate limits, or features. Returns the official llms.txt documentation which is optimized for AI consumption.',
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
        .describe('Documentation topic to fetch'),
      section: z
        .string()
        .optional()
        .describe(
          'Optional: specific section to extract (e.g., "credits", "rate limits", "parameters"). If provided, returns only matching sections.'
        ),
    },
    async ({ topic, section }) => {
      try {
        const content = await fetchDoc(topic);

        // If a section filter is provided, extract relevant parts
        if (section) {
          const sectionLower = section.toLowerCase();
          const lines = content.split('\n');
          const relevantLines: string[] = [];
          let inRelevantSection = false;
          let sectionDepth = 0;

          for (const line of lines) {
            // Check if this is a header
            const headerMatch = line.match(/^(#{1,4})\s+(.+)/);
            if (headerMatch) {
              const depth = headerMatch[1].length;
              const title = headerMatch[2].toLowerCase();

              if (title.includes(sectionLower)) {
                inRelevantSection = true;
                sectionDepth = depth;
                relevantLines.push(line);
              } else if (inRelevantSection && depth <= sectionDepth) {
                // We've hit a new section at same or higher level
                inRelevantSection = false;
              } else if (inRelevantSection) {
                relevantLines.push(line);
              }
            } else if (inRelevantSection) {
              relevantLines.push(line);
            } else if (line.toLowerCase().includes(sectionLower)) {
              // Include lines that mention the section keyword even outside headers
              relevantLines.push(line);
            }
          }

          if (relevantLines.length > 0) {
            const result = [
              `# Helius Docs: ${topic} (filtered by "${section}")`,
              '',
              ...relevantLines,
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
                  text: `No sections matching "${section}" found in ${topic} docs. Returning full documentation:\n\n${content}`,
                },
              ],
            };
          }
        }

        // Return full documentation
        const result = [
          `# Helius Docs: ${topic}`,
          '',
          content,
          '',
          '---',
          `Source: https://www.helius.dev/docs`,
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
        'Use `lookupHeliusDocs` with any of these topics to fetch official documentation:',
        '',
        '| Topic | Description |',
        '|-------|-------------|',
        ...index.map((doc) => `| \`${doc.key}\` | ${doc.description} |`),
        '',
        '## Usage Examples',
        '',
        '```',
        '// Get overview with plans, credits, rate limits',
        'lookupHeliusDocs({ topic: "overview" })',
        '',
        '// Get DAS API documentation',
        'lookupHeliusDocs({ topic: "das" })',
        '',
        '// Get specific section from docs',
        'lookupHeliusDocs({ topic: "overview", section: "credits" })',
        'lookupHeliusDocs({ topic: "das", section: "rate limits" })',
        '```',
      ];

      return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
    }
  );

  /**
   * Get credits information from official docs
   */
  server.tool(
    'getHeliusCreditsInfo',
    'Get official Helius credit costs from documentation. Fetches the latest pricing information directly from Helius docs.',
    {},
    async () => {
      try {
        const content = await fetchDoc('overview');

        // Extract credits section
        const lines = content.split('\n');
        const creditsLines: string[] = [];
        let inCreditsSection = false;

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];

          // Look for Credits section
          if (line.includes('## Credits') || line.includes('| Credits |')) {
            inCreditsSection = true;
          }

          if (inCreditsSection) {
            creditsLines.push(line);

            // Stop at next major section
            if (creditsLines.length > 2 && line.startsWith('## ') && !line.includes('Credits')) {
              creditsLines.pop(); // Remove the next section header
              break;
            }
          }
        }

        // Also look for the credits table
        const tableLines: string[] = [];
        for (let i = 0; i < lines.length; i++) {
          if (lines[i].includes('| Credits |') || lines[i].includes('| 0 |') || lines[i].includes('| 1 |') || lines[i].includes('| 3 |') || lines[i].includes('| 10 |') || lines[i].includes('| 100 |')) {
            // Collect table lines
            let j = i;
            while (j < lines.length && (lines[j].includes('|') || lines[j].trim() === '')) {
              if (lines[j].includes('|')) {
                tableLines.push(lines[j]);
              }
              j++;
              if (j - i > 20) break; // Safety limit
            }
            break;
          }
        }

        const result = [
          '# Helius Credit Costs (Official)',
          '',
          'Source: https://www.helius.dev/docs (fetched live)',
          '',
          ...tableLines,
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
