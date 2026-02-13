import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getHeliusClient, hasApiKey } from '../utils/helius.js';
import { formatAddress } from '../utils/formatters.js';
import { mcpText, mcpError, handleToolError, addressError, notFoundError, paginationError } from '../utils/errors.js';
import { noApiKeyResponse } from './shared.js';

export function registerDasExtraTools(server: McpServer) {
  server.tool(
    'getAssetProof',
    'Get Merkle proof for a compressed NFT. Required for transferring or burning cNFTs.',
    {
      id: z.string().describe('Compressed NFT mint address')
    },
    async ({ id }) => {
      if (!hasApiKey()) return noApiKeyResponse();
      try {
        const helius = getHeliusClient();
        const proof = await helius.getAssetProof({ id });
        return mcpText(`**Merkle Proof for ${formatAddress(id)}**\n\n**Root:** ${formatAddress(proof.root)}\n**Leaf:** ${formatAddress(proof.leaf)}\n**Tree ID:** ${formatAddress(proof.tree_id)}\n**Proof Length:** ${proof.proof.length} nodes`);
      } catch (err) {
        const header = `Merkle Proof for ${formatAddress(id)}`;
        return handleToolError(err, 'Error fetching asset proof', [
          notFoundError(header, 'Asset proof not found. This asset may not be a compressed NFT (cNFT), or the mint address does not exist.'),
          addressError(header, 'Invalid Solana address. Please provide a valid base58-encoded mint address.'),
        ]);
      }
    }
  );

  server.tool(
    'getAssetProofBatch',
    'Get Merkle proofs for multiple compressed NFTs in one request (up to 1000).',
    {
      ids: z.array(z.string()).describe('Array of cNFT mint addresses (up to 1000)')
    },
    async ({ ids }) => {
      if (!hasApiKey()) return noApiKeyResponse();
      try {
        if (ids.length > 1000) {
          return mcpError('Max 1000 proofs per batch');
        }
        const helius = getHeliusClient();
        const result = await helius.getAssetProofBatch({ ids });
        const proofsArray = Array.isArray(result) ? result : Object.values(result);
        return mcpText(`**Batch Merkle Proofs** (${proofsArray.length})\n\n${proofsArray.map((p: any, i: number) => `${i + 1}. ${formatAddress(ids[i])}\n   Root: ${formatAddress(p.root)}`).join('\n\n')}`);
      } catch (err) {
        return handleToolError(err, 'Error fetching asset proofs', [
          notFoundError('Batch Merkle Proofs', 'One or more asset proofs were not found. Some assets may not be compressed NFTs (cNFTs), or the mint addresses may not exist.'),
          addressError('Batch Merkle Proofs', 'One or more provided IDs are not valid Solana addresses. Please check the mint addresses and try again.'),
        ]);
      }
    }
  );

  server.tool(
    'getSignaturesForAsset',
    'Get transaction history for a compressed NFT.',
    {
      id: z.string().describe('Compressed NFT mint address'),
      page: z.number().optional().default(1),
      limit: z.number().optional().default(20)
    },
    async ({ id, page, limit }) => {
      if (!hasApiKey()) return noApiKeyResponse();
      try {
        const helius = getHeliusClient();
        const result = await helius.getSignaturesForAsset({ id, page, limit });
        if (!result.items?.length) {
          return mcpText(`**Signatures for ${formatAddress(id)}**\n\nNo transactions found.`);
        }
        const lines = [`**Signatures for ${formatAddress(id)}** (${result.total} total)`, ''];
        result.items.forEach((sig: any, i: number) => {
          lines.push(`${i + 1}. ${sig.signature}`);
          if (sig.blockTime) lines.push(`   Time: ${new Date(sig.blockTime * 1000).toLocaleString()}`);
        });
        return mcpText(lines.join('\n'));
      } catch (err) {
        const header = `Signatures for ${formatAddress(id)}`;
        return handleToolError(err, 'Error fetching signatures', [
          notFoundError(header, 'Asset not found. This mint address does not exist or has not been indexed.'),
          addressError(header, 'Invalid Solana address. Please provide a valid base58-encoded mint address.'),
          paginationError(header),
        ]);
      }
    }
  );

  server.tool(
    'getNftEditions',
    'Get all edition NFTs for a master NFT.',
    {
      mint: z.string().describe('Master NFT mint address'),
      page: z.number().optional().default(1),
      limit: z.number().optional().default(20)
    },
    async ({ mint, page, limit }) => {
      if (!hasApiKey()) return noApiKeyResponse();
      try {
        const helius = getHeliusClient();
        const result = await helius.getNftEditions({ mint, page, limit });
        if (!result.editions?.length) {
          return mcpText(`**Editions for ${formatAddress(mint)}**\n\nNo editions found.`);
        }
        const lines = [`**Editions for ${formatAddress(mint)}** (${result.total} total)`, ''];
        result.editions.forEach((edition: any, i: number) => {
          lines.push(`${i + 1}. Edition #${edition.edition_number}`);
          lines.push(`   Mint: ${formatAddress(edition.mint)}`);
          if (edition.owner) lines.push(`   Owner: ${formatAddress(edition.owner)}`);
        });
        return mcpText(lines.join('\n'));
      } catch (err) {
        const header = `Editions for ${formatAddress(mint)}`;
        return handleToolError(err, 'Error fetching editions', [
          { match: (m) => m.includes('null value was encountered'), respond: () => mcpText(`**${header}**\n\nThis mint is not a master edition NFT. getNftEditions only works with master edition mints.`) },
          notFoundError(header, 'Asset not found. This mint address does not exist or has not been indexed.'),
          addressError(header, 'Invalid Solana address. Please provide a valid base58-encoded mint address.'),
          paginationError(header),
        ]);
      }
    }
  );
}
