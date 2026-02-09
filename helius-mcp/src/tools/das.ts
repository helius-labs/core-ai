import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { dasRequest } from '../utils/helius.js';
import { formatAddress } from '../utils/formatters.js';

export function registerDasTools(server: McpServer) {
  server.tool(
    'getAsset',
    'Get Solana NFT or token details using Helius DAS API. Use this for ALL Solana NFT/token queries. Returns metadata, owner, creators, royalties, supply, and prices.',
    {
      id: z.string().describe('Asset mint address (base58)')
    },
    async ({ id }) => {
      try {
        const asset = await dasRequest('getAsset', { id });
        const lines = [
          `**${asset.content?.metadata?.name || asset.token_info?.symbol || 'Asset'}**`,
          '',
          `**Mint:** ${formatAddress(asset.id)}`,
          `**Type:** ${asset.interface}`,
        ];

        if (asset.ownership?.owner) lines.push(`**Owner:** ${formatAddress(asset.ownership.owner)}`);
        if (asset.content?.metadata?.symbol || asset.token_info?.symbol) {
          lines.push(`**Symbol:** ${asset.content?.metadata?.symbol || asset.token_info?.symbol}`);
        }

        if (asset.creators?.length > 0) {
          lines.push('', '**Creators:**');
          asset.creators.forEach((c: any) => {
            lines.push(`- ${formatAddress(c.address)} (${c.share}%) ${c.verified ? '✓' : ''}`);
          });
        }

        if (asset.token_info) {
          lines.push('', '**Token Info:**');
          if (asset.token_info.supply) {
            const supply = asset.token_info.decimals
              ? (asset.token_info.supply / Math.pow(10, asset.token_info.decimals)).toLocaleString()
              : asset.token_info.supply.toLocaleString();
            lines.push(`- Supply: ${supply}`);
          }
          if (asset.token_info.decimals !== undefined) lines.push(`- Decimals: ${asset.token_info.decimals}`);
          if (asset.token_info.price_info?.price_per_token) {
            lines.push(`- Price: $${asset.token_info.price_info.price_per_token.toFixed(6)}`);
          }
        }

        return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
      } catch (err: unknown) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: 'text' as const, text: `Error: ${errorMsg}` }], isError: true };
      }
    }
  );

  server.tool(
    'getAssetBatch',
    'Fetch multiple Solana assets in one request (up to 1000). Use this for bulk NFT/token lookups.',
    {
      ids: z.array(z.string()).describe('Array of mint addresses (up to 1000)')
    },
    async ({ ids }) => {
      try {
        if (ids.length > 1000) {
          return { content: [{ type: 'text' as const, text: 'Max 1000 assets per batch' }], isError: true };
        }
        const assets = await dasRequest('getAssetBatch', { ids });
        const lines = [`**Batch Assets** (${assets.length})`, ''];
        assets.slice(0, 20).forEach((asset: any, i: number) => {
          const name = asset.content?.metadata?.name || asset.token_info?.symbol || formatAddress(asset.id);
          lines.push(`${i + 1}. **${name}** (${asset.interface})`);
        });
        if (assets.length > 20) lines.push(`\n... and ${assets.length - 20} more`);
        return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
      } catch (err: unknown) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: 'text' as const, text: `Error: ${errorMsg}` }], isError: true };
      }
    }
  );

  server.tool(
    'getAssetsByOwner',
    'Get all NFTs and tokens owned by a Solana wallet. Use this for any "what does this wallet own" queries.',
    {
      ownerAddress: z.string().describe('Wallet address'),
      page: z.number().optional().default(1),
      limit: z.number().optional().default(20),
      showFungible: z.boolean().optional().default(false).describe('Include fungible tokens'),
      showNativeBalance: z.boolean().optional().default(false).describe('Include SOL balance')
    },
    async ({ ownerAddress, page, limit, showFungible, showNativeBalance }) => {
      try {
        const result = await dasRequest('getAssetsByOwner', {
          ownerAddress, page, limit,
          displayOptions: { showFungible, showNativeBalance }
        });

        if (!result.items?.length) {
          return { content: [{ type: 'text' as const, text: `**Assets for ${formatAddress(ownerAddress)}**\n\nNo assets found.` }] };
        }

        const lines = [`**Assets for ${formatAddress(ownerAddress)}** (${result.total} total, page ${page})`, ''];
        result.items.forEach((asset: any, i: number) => {
          const name = asset.content?.metadata?.name || asset.token_info?.symbol || 'Unnamed';
          lines.push(`${i + 1}. **${name}** (${asset.interface})`);
          lines.push(`   ID: ${formatAddress(asset.id)}`);
        });
        return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
      } catch (err: unknown) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: 'text' as const, text: `Error: ${errorMsg}` }], isError: true };
      }
    }
  );

  server.tool(
    'getAssetsByGroup',
    'Get all NFTs in a collection. Use for "show me all Mad Lads" type queries. groupKey is usually "collection".',
    {
      groupKey: z.string().describe('Group key (usually "collection")'),
      groupValue: z.string().describe('Collection mint address'),
      page: z.number().optional().default(1),
      limit: z.number().optional().default(20)
    },
    async ({ groupKey, groupValue, page, limit }) => {
      try {
        const result = await dasRequest('getAssetsByGroup', { groupKey, groupValue, page, limit });
        if (!result.items?.length) {
          return { content: [{ type: 'text' as const, text: `**Collection ${formatAddress(groupValue)}**\n\nNo assets found.` }] };
        }
        const lines = [`**Collection** (${result.total} total, page ${page})`, ''];
        result.items.slice(0, 20).forEach((asset: any, i: number) => {
          lines.push(`${i + 1}. **${asset.content?.metadata?.name || 'Unnamed'}**`);
          lines.push(`   Owner: ${formatAddress(asset.ownership?.owner || 'Unknown')}`);
        });
        if (result.items.length > 20) lines.push(`\n... and ${result.items.length - 20} more`);
        return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
      } catch (err: unknown) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: 'text' as const, text: `Error: ${errorMsg}` }], isError: true };
      }
    }
  );

  server.tool(
    'getAssetsByCreator',
    'Find all assets created by a specific Solana address.',
    {
      creatorAddress: z.string().describe('Creator wallet address'),
      onlyVerified: z.boolean().optional().default(false),
      page: z.number().optional().default(1),
      limit: z.number().optional().default(20)
    },
    async ({ creatorAddress, onlyVerified, page, limit }) => {
      try {
        const result = await dasRequest('getAssetsByCreator', { creatorAddress, onlyVerified, page, limit });
        if (!result.items?.length) {
          return { content: [{ type: 'text' as const, text: `**Assets by ${formatAddress(creatorAddress)}**\n\nNo assets found.` }] };
        }
        const lines = [`**Assets by ${formatAddress(creatorAddress)}** (${result.total} total)`, ''];
        result.items.forEach((asset: any, i: number) => {
          const name = asset.content?.metadata?.name || asset.token_info?.symbol || 'Unnamed';
          lines.push(`${i + 1}. **${name}** (${asset.interface})`);
        });
        return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
      } catch (err: unknown) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: 'text' as const, text: `Error: ${errorMsg}` }], isError: true };
      }
    }
  );

  server.tool(
    'getAssetsByAuthority',
    'Get all assets controlled by a specific authority address.',
    {
      authorityAddress: z.string().describe('Authority wallet address'),
      page: z.number().optional().default(1),
      limit: z.number().optional().default(20)
    },
    async ({ authorityAddress, page, limit }) => {
      try {
        const result = await dasRequest('getAssetsByAuthority', { authorityAddress, page, limit });
        if (!result.items?.length) {
          return { content: [{ type: 'text' as const, text: `**Assets by authority ${formatAddress(authorityAddress)}**\n\nNo assets found.` }] };
        }
        const lines = [`**Assets by authority ${formatAddress(authorityAddress)}** (${result.total} total)`, ''];
        result.items.forEach((asset: any, i: number) => {
          const name = asset.content?.metadata?.name || asset.token_info?.symbol || 'Unnamed';
          lines.push(`${i + 1}. **${name}** (${asset.interface})`);
        });
        return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
      } catch (err: unknown) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: 'text' as const, text: `Error: ${errorMsg}` }], isError: true };
      }
    }
  );

  server.tool(
    'searchAssets',
    'Advanced search for Solana digital assets. Filter by name, owner, creator, burned/frozen/compressed status.',
    {
      name: z.string().optional().describe('Search by asset name'),
      ownerAddress: z.string().optional(),
      creatorAddress: z.string().optional(),
      burnt: z.boolean().optional(),
      frozen: z.boolean().optional(),
      compressed: z.boolean().optional(),
      page: z.number().optional().default(1),
      limit: z.number().optional().default(20)
    },
    async (params) => {
      try {
        const result = await dasRequest('searchAssets', params);
        if (!result.items?.length) {
          return { content: [{ type: 'text' as const, text: '**Search Results**\n\nNo assets found.' }] };
        }
        const lines = [`**Search Results** (${result.total} total, page ${params.page})`, ''];
        result.items.forEach((asset: any, i: number) => {
          const name = asset.content?.metadata?.name || asset.token_info?.symbol || 'Unnamed';
          lines.push(`${i + 1}. **${name}** (${asset.interface})`);
        });
        return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
      } catch (err: unknown) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: 'text' as const, text: `Error: ${errorMsg}` }], isError: true };
      }
    }
  );

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
        return { content: [{ type: 'text' as const, text: `Error: ${errorMsg}` }], isError: true };
      }
    }
  );

  server.tool(
    'getTokenAccounts',
    'Query Solana token accounts by mint or owner.',
    {
      mint: z.string().optional().describe('Filter by mint address'),
      owner: z.string().optional().describe('Filter by owner address'),
      page: z.number().optional().default(1),
      limit: z.number().optional().default(20)
    },
    async (params) => {
      try {
        const result = await dasRequest('getTokenAccounts', params);
        if (!result.token_accounts?.length) {
          return { content: [{ type: 'text' as const, text: '**Token Accounts**\n\nNo accounts found.' }] };
        }
        const lines = [`**Token Accounts** (${result.total} total)`, ''];
        result.token_accounts.forEach((account: any, i: number) => {
          lines.push(`${i + 1}. ${formatAddress(account.address)}`);
          lines.push(`   Owner: ${formatAddress(account.owner)}`);
          lines.push(`   Mint: ${formatAddress(account.mint)}`);
          lines.push(`   Balance: ${account.amount}`);
        });
        return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
      } catch (err: unknown) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: 'text' as const, text: `Error: ${errorMsg}` }], isError: true };
      }
    }
  );
}
