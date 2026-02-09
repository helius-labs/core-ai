#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { registerTools } from './tools/index.js';
import { setApiKey } from './utils/helius.js';

const server = new McpServer({
  name: 'helius-mcp',
  version: '0.2.4'
});

registerTools(server);

async function main() {
  if (process.env.HELIUS_API_KEY) {
    setApiKey(process.env.HELIUS_API_KEY);
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error('Failed to start:', error);
  process.exit(1);
});
