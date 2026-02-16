#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { registerTools } from './tools/index.js';
import { setApiKey, setSessionSecretKey, setSessionWalletAddress } from './utils/helius.js';
import { getSharedApiKey, loadKeypairFromDisk } from './utils/config.js';
import { loadKeypair } from 'helius-sdk/auth/loadKeypair';
import { getAddress } from 'helius-sdk/auth/getAddress';

const server = new McpServer({
  name: 'helius-mcp',
  version: '0.3.0'
});

registerTools(server);

async function main() {
  if (process.env.HELIUS_API_KEY) {
    setApiKey(process.env.HELIUS_API_KEY);
  } else {
    const sharedKey = getSharedApiKey();
    if (sharedKey) {
      setApiKey(sharedKey);
    }
  }

  // Load persisted keypair from disk so MCP survives restarts
  const diskKey = loadKeypairFromDisk();
  if (diskKey) {
    try {
      const walletKeypair = loadKeypair(diskKey);
      const address = await getAddress(walletKeypair);
      setSessionSecretKey(diskKey);
      setSessionWalletAddress(address);
    } catch {
      // Ignore invalid keypair on disk
    }
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error('Failed to start:', error);
  process.exit(1);
});
