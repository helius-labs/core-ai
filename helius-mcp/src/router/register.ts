import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { dispatchRoutedTool, expandStoredResult } from './dispatch.js';
import { withTelemetryHandler } from './telemetry.js';
import {
  EXPAND_RESULT_SCHEMA,
  HELIUS_ACCOUNT_SCHEMA,
  HELIUS_ASSET_SCHEMA,
  HELIUS_CHAIN_SCHEMA,
  HELIUS_COMPRESSION_SCHEMA,
  HELIUS_KNOWLEDGE_SCHEMA,
  HELIUS_STREAMING_SCHEMA,
  HELIUS_TRANSACTION_SCHEMA,
  HELIUS_WALLET_SCHEMA,
  HELIUS_WRITE_SCHEMA,
} from './schemas.js';

export function registerRouterTools(server: McpServer): void {
  server.tool(
    'heliusAccount',
    'Account setup, auth, plans, and billing actions.',
    HELIUS_ACCOUNT_SCHEMA,
    withTelemetryHandler('heliusAccount', (params, extra) => dispatchRoutedTool('heliusAccount', params, extra)),
  );

  server.tool(
    'heliusWallet',
    'Wallet balances, holdings, identity, and wallet history.',
    HELIUS_WALLET_SCHEMA,
    withTelemetryHandler('heliusWallet', (params, extra) => dispatchRoutedTool('heliusWallet', params, extra)),
  );

  server.tool(
    'heliusAsset',
    'Asset, NFT, collection, and token holder actions.',
    HELIUS_ASSET_SCHEMA,
    withTelemetryHandler('heliusAsset', (params, extra) => dispatchRoutedTool('heliusAsset', params, extra)),
  );

  server.tool(
    'heliusTransaction',
    'Transaction parsing and wallet transaction history actions.',
    HELIUS_TRANSACTION_SCHEMA,
    withTelemetryHandler('heliusTransaction', (params, extra) => dispatchRoutedTool('heliusTransaction', params, extra)),
  );

  server.tool(
    'heliusChain',
    'Chain state, token accounts, stake reads, blocks, and network status.',
    HELIUS_CHAIN_SCHEMA,
    withTelemetryHandler('heliusChain', (params, extra) => dispatchRoutedTool('heliusChain', params, extra)),
  );

  server.tool(
    'heliusStreaming',
    'Webhook CRUD and live subscription configuration actions.',
    HELIUS_STREAMING_SCHEMA,
    withTelemetryHandler('heliusStreaming', (params, extra) => dispatchRoutedTool('heliusStreaming', params, extra)),
  );

  server.tool(
    'heliusKnowledge',
    'Docs, guides, pricing, troubleshooting, source, blog, and SIMD actions.',
    HELIUS_KNOWLEDGE_SCHEMA,
    withTelemetryHandler('heliusKnowledge', (params, extra) => dispatchRoutedTool('heliusKnowledge', params, extra)),
  );

  server.tool(
    'heliusWrite',
    'Mutating actions for transfers and staking.',
    HELIUS_WRITE_SCHEMA,
    withTelemetryHandler('heliusWrite', (params, extra) => dispatchRoutedTool('heliusWrite', params, extra)),
  );

  server.tool(
    'heliusCompression',
    'Compressed account, proof, balance, and compression history actions.',
    HELIUS_COMPRESSION_SCHEMA,
    withTelemetryHandler('heliusCompression', (params, extra) => dispatchRoutedTool('heliusCompression', params, extra)),
  );

  server.tool(
    'expandResult',
    'Expand a prior summary result using resultId.',
    EXPAND_RESULT_SCHEMA,
    withTelemetryHandler('expandResult', (params, extra) => expandStoredResult(params, extra)),
  );
}
