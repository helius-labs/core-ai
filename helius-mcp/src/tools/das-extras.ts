import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { dasRequest } from '../utils/helius.js';
import { formatAddress } from '../utils/formatters.js';

export function registerDasExtraTools(server: McpServer) {
  server.tool(
    'getAssetProof',
    'Get Merkle proof for a compressed NFT. Required for transferring or burning cNFTs.',
    {
      id: z.string().describe('Compressed NFT mint address')
    },
    async ({ id }) => {
      try {
        const proof = await dasRequest('getAssetProof', { id });
        return {
          content: [{
            type: 'text' as const,
            text: `**Merkle Proof for ${formatAddress(id)}**\n\n**Root:** ${formatAddress(proof.root)}\n**Leaf:** ${formatAddress(proof.leaf)}\n**Tree ID:** ${formatAddress(proof.tree_id)}\n**Proof Length:** ${proof.proof.length} nodes`
          }]
        };
      } catch (err: unknown) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: 'text' as const, text: `Error: ${errorMsg}` }], isError: true };
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
      try {
        if (ids.length > 1000) {
          return { content: [{ type: 'text' as const, text: 'Max 1000 proofs per batch' }], isError: true };
        }
        const result = await dasRequest('getAssetProofBatch', { ids });
        const proofsArray = Array.isArray(result) ? result : Object.values(result);
        return {
          content: [{
            type: 'text' as const,
            text: `**Batch Merkle Proofs** (${proofsArray.length})\n\n${proofsArray.map((p: any, i: number) => `${i + 1}. ${formatAddress(ids[i])}\n   Root: ${formatAddress(p.root)}`).join('\n\n')}`
          }]
        };
      } catch (err: unknown) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: 'text' as const, text: `Error: ${errorMsg}` }], isError: true };
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
      try {
        const result = await dasRequest('getSignaturesForAsset', { id, page, limit });
        if (!result.items?.length) {
          return { content: [{ type: 'text' as const, text: `**Signatures for ${formatAddress(id)}**\n\nNo transactions found.` }] };
        }
        const lines = [`**Signatures for ${formatAddress(id)}** (${result.total} total)`, ''];
        result.items.forEach((sig: any, i: number) => {
          lines.push(`${i + 1}. ${sig.signature}`);
          if (sig.blockTime) lines.push(`   Time: ${new Date(sig.blockTime * 1000).toLocaleString()}`);
        });
        return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
      } catch (err: unknown) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: 'text' as const, text: `Error: ${errorMsg}` }], isError: true };
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
      try {
        const result = await dasRequest('getNftEditions', { mint, page, limit });
        if (!result.editions?.length) {
          return { content: [{ type: 'text' as const, text: `**Editions for ${formatAddress(mint)}**\n\nNo editions found.` }] };
        }
        const lines = [`**Editions for ${formatAddress(mint)}** (${result.total} total)`, ''];
        result.editions.forEach((edition: any, i: number) => {
          lines.push(`${i + 1}. Edition #${edition.edition_number}`);
          lines.push(`   Mint: ${formatAddress(edition.mint)}`);
          if (edition.owner) lines.push(`   Owner: ${formatAddress(edition.owner)}`);
        });
        return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
      } catch (err: unknown) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        if (errorMsg.includes('null value was encountered while decoding')) {
          return { content: [{ type: 'text' as const, text: `**Editions for ${formatAddress(mint)}**\n\nThis mint is not a master edition NFT. getNftEditions only works with master edition mints.` }] };
        }
        return { content: [{ type: 'text' as const, text: `Error: ${errorMsg}` }], isError: true };
      }
    }
  );
}
