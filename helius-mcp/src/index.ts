#!/usr/bin/env node

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer } from './server.js';
import { resolveSurface } from './router/surface.js';
import { setApiKey, setSessionSecretKey, setSessionWalletAddress } from './utils/helius.js';
import { getSharedApiKey, loadKeypairFromDisk } from './utils/config.js';
import { isSharedCredentialMode } from './utils/runtime.js';
import { captureWalletAddress } from './utils/feedback.js';
import { loadKeypair } from 'helius-sdk/auth/loadKeypair';
import { getAddress } from 'helius-sdk/auth/getAddress';

// `--read-only` or HELIUS_MCP_READ_ONLY=1 serves only actions that do not change state.
const server = createServer({ surface: resolveSurface() });

async function main() {
  if (isSharedCredentialMode()) {
    // Fail at deploy time rather than answering every request with NO_API_KEY,
    // which looks like a healthy server serving errors.
    if (!process.env.HELIUS_API_KEY) {
      console.error(
        'HELIUS_MCP_SHARED_CREDENTIAL is set but HELIUS_API_KEY is missing. '
        + 'A shared-credential deployment must be given its key via the environment.',
      );
      process.exit(1);
    }

    // getApiKey() already resolves HELIUS_API_KEY, so there is nothing to seed.
    // Deliberately no keypair: a server acting for many callers must not hold a
    // signing key, and the tools that would use one are off this surface.
  } else {
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
        captureWalletAddress(address);
      } catch {
        // Ignore invalid keypair on disk
      }
    }
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error('Failed to start:', error);
  process.exit(1);
});
