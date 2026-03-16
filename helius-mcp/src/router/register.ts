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
    'Account setup, API keys, signup, plans, and billing. Use for pricing or account state, not per-method rate limits.',
    HELIUS_ACCOUNT_SCHEMA,
    withTelemetryHandler('heliusAccount', (params, extra) => dispatchRoutedTool('heliusAccount', params, extra)),
  );

  server.tool(
    'heliusWallet',
    'Wallet-centric balances, holdings, identity, and wallet history. Use for portfolio views, not raw token accounts.',
    HELIUS_WALLET_SCHEMA,
    withTelemetryHandler('heliusWallet', (params, extra) => dispatchRoutedTool('heliusWallet', params, extra)),
  );

  server.tool(
    'heliusAsset',
    'Assets, NFTs, collections, proofs, and token holders. Use for DAS ownership or metadata, not transaction history.',
    HELIUS_ASSET_SCHEMA,
    withTelemetryHandler('heliusAsset', (params, extra) => dispatchRoutedTool('heliusAsset', params, extra)),
  );

  server.tool(
    'heliusTransaction',
    'Parsed transactions and wallet transaction history. Use for activity analysis, not raw account state.',
    HELIUS_TRANSACTION_SCHEMA,
    withTelemetryHandler('heliusTransaction', (params, extra) => dispatchRoutedTool('heliusTransaction', params, extra)),
  );

  server.tool(
    'heliusChain',
    'Raw chain state, token accounts, stake reads, blocks, network status, and priority fees. Use for token accounts or blocks, not wallet portfolio summaries.',
    HELIUS_CHAIN_SCHEMA,
    withTelemetryHandler('heliusChain', (params, extra) => dispatchRoutedTool('heliusChain', params, extra)),
  );

  server.tool(
    'heliusStreaming',
    'Webhook CRUD and live subscription configuration. Use for actual webhook/subscription setup, not how-to guides.',
    HELIUS_STREAMING_SCHEMA,
    withTelemetryHandler('heliusStreaming', (params, extra) => dispatchRoutedTool('heliusStreaming', params, extra)),
  );

  server.tool(
    'heliusKnowledge',
    'Docs, guides, pricing references, troubleshooting, source, blog, and SIMD research. Use for guides, rate limits, or errors, not live mutations.',
    HELIUS_KNOWLEDGE_SCHEMA,
    withTelemetryHandler('heliusKnowledge', (params, extra) => dispatchRoutedTool('heliusKnowledge', params, extra)),
  );

  server.tool(
    'heliusWrite',
    'Mutating SOL/token transfer and staking actions. Use for sends or staking, not read-only queries.',
    HELIUS_WRITE_SCHEMA,
    withTelemetryHandler('heliusWrite', (params, extra) => dispatchRoutedTool('heliusWrite', params, extra)),
  );

  server.tool(
    'heliusCompression',
    'Compressed account, proof, balance, and compression history queries. Use for zk-compression state, not standard DAS assets.',
    HELIUS_COMPRESSION_SCHEMA,
    withTelemetryHandler('heliusCompression', (params, extra) => dispatchRoutedTool('heliusCompression', params, extra)),
  );

  server.tool(
    'expandResult',
    'Expand a prior summary-first result by resultId, section, range, page, or continuation.',
    EXPAND_RESULT_SCHEMA,
    withTelemetryHandler('expandResult', (params, extra) => expandStoredResult(params, extra)),
  );
}
