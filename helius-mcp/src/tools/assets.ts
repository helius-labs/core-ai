import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getHeliusClient, hasApiKey } from '../utils/helius.js';
import { formatAddress } from '../utils/formatters.js';
import { noApiKeyResponse } from './shared.js';
import { mcpText, handleToolError, addressError, paginationError, notFoundError } from '../utils/errors.js';

export function registerAssetTools(server: McpServer) {
  // Get Assets by Owner (NFTs and tokens via DAS)
  server.tool(
    'getAssetsByOwner',
    'Get all NFTs and digital assets owned by a Solana wallet using the DAS (Digital Asset Standard) API. Returns asset names, types (NFT, cNFT, Fungible, etc.), and mint addresses. Supports both regular NFTs and compressed NFTs (cNFTs). Use this to see what NFTs/collectibles a wallet owns. For fungible token balances, use getTokenBalances instead. DAS API (10 credits/call).',
    {
      address: z.string().describe('Solana wallet address (base58 encoded)'),
      limit: z.number().optional().default(20).describe('Number of assets to return (default 20). Increase for wallets with many NFTs.'),
      page: z.number().optional().default(1).describe('Page number (starts at 1)')
    },
    async ({ address, limit, page }) => {
      if (!hasApiKey()) return noApiKeyResponse();
      const helius = getHeliusClient();
      let response;
      try {
        response = await helius.getAssetsByOwner({
          ownerAddress: address,
          page,
          limit
        });
      } catch (err) {
        const header = `Assets for ${formatAddress(address)}`;
        return handleToolError(err, 'Error fetching assets', [
          addressError(header, 'Invalid Solana address. Please provide a valid base58-encoded wallet address.'),
          paginationError(header),
        ]);
      }

      if (!response.items || response.items.length === 0) {
        return mcpText(`**Assets for ${formatAddress(address)}**\n\nNo assets found.`);
      }

      type AssetItem = {
        id: string;
        interface: string;
        content?: { metadata?: { name?: string; symbol?: string } };
        token_info?: { symbol?: string };
      };

      const items = response.items as AssetItem[];

      // Enrich assets missing name/symbol
      const unknownAssets = items.filter((asset) =>
        !asset.content?.metadata?.name && !asset.content?.metadata?.symbol && !asset.token_info?.symbol
      );

      if (unknownAssets.length > 0 && unknownAssets.length <= 10) {
        const enrichedData = await Promise.allSettled(
          unknownAssets.map((asset) => helius.getAsset({ id: asset.id }))
        );

        enrichedData.forEach((result, idx) => {
          if (result.status === 'fulfilled' && result.value) {
            const enriched = result.value as AssetItem;
            const original = unknownAssets[idx];
            if (enriched.content?.metadata) {
              original.content = original.content || {};
              original.content.metadata = enriched.content.metadata;
            }
            if (enriched.token_info?.symbol) {
              original.token_info = original.token_info || {};
              original.token_info.symbol = enriched.token_info.symbol;
            }
          }
        });
      }

      const lines = [`**Assets for ${formatAddress(address)}** (${response.total} total, page ${page})`, ''];

      items.forEach((asset) => {
        const name = asset.content?.metadata?.name || asset.content?.metadata?.symbol || asset.token_info?.symbol || 'Unnamed';
        lines.push(`- **${name}** (${asset.interface})`);
        lines.push(`  ID: ${formatAddress(asset.id)}`);
      });

      return mcpText(lines.join('\n'));
    }
  );

  // Get Asset (single or batch)
  server.tool(
    'getAsset',
    'Get detailed information about one or more NFTs/tokens by mint address. For a single asset: returns name, symbol, description, image, owner, creators, authorities, supply, decimals, royalties, mutability. For batch: pass an array of up to 1000 mint addresses in "ids" for fast bulk lookups. Use this to find who created/deployed a token, verify token details, or get full NFT metadata. DAS API (10 credits/call).',
    {
      id: z.string().optional().describe('Single asset mint address (base58 encoded). Use this OR ids, not both.'),
      ids: z.array(z.string()).optional().describe('Array of asset mint addresses for batch lookup (up to 1000). Use this OR id, not both.')
    },
    async ({ id, ids }) => {
      if (!hasApiKey()) return noApiKeyResponse();
      const helius = getHeliusClient();

      // Validate: must provide exactly one of id or ids
      if (!id && (!ids || ids.length === 0)) {
        return mcpText(`**Error:** Provide either "id" (single asset) or "ids" (batch of up to 1000).`);
      }

      if (id && ids && ids.length > 0) {
        return mcpText(`**Error:** Provide either "id" or "ids", not both.`);
      }

      type Creator = { address: string; share: number; verified: boolean };
      type Authority = { address: string; scopes: string[] };
      type AssetResponse = {
        id: string;
        interface: string;
        content?: {
          metadata?: { name?: string; symbol?: string; description?: string };
          links?: { image?: string };
        };
        ownership?: { owner?: string };
        creators?: Creator[];
        authorities?: Authority[];
        royalty?: { percent: number };
        mutable?: boolean;
        burnt?: boolean;
        token_info?: {
          symbol?: string;
          supply?: number;
          decimals?: number;
          token_program?: string;
          price_info?: { price_per_token?: number; currency?: string };
        };
      };

      // --- Batch mode ---
      if (ids && ids.length > 0) {
        if (ids.length > 1000) {
          return mcpText(`**Error:** Maximum 1000 assets per batch. You provided ${ids.length}.`);
        }

        let assets;
        try {
          assets = await helius.getAssetBatch({ ids });
        } catch (err) {
          return handleToolError(err, 'Error fetching assets', [
            addressError('Asset Batch Error', 'One or more provided IDs are not valid Solana addresses. Please check the mint addresses and try again.'),
            notFoundError('Asset Batch Results', 'One or more assets were not found. Please check the mint addresses and try again.'),
          ]);
        }
        const items = (assets || []) as AssetResponse[];

        if (items.length === 0) {
          return mcpText(`**Asset Batch Results**\n\nNo assets found.`);
        }

        const lines = [`**Asset Batch Results** (${items.length} assets)`, ''];

        items.forEach((asset) => {
          if (!asset) return;
          const assetName = asset.content?.metadata?.name || asset.content?.metadata?.symbol || asset.token_info?.symbol || 'Unnamed';
          lines.push(`- **${assetName}** (${asset.interface})`);
          lines.push(`  ID: ${formatAddress(asset.id)}`);
          if (asset.ownership?.owner) {
            lines.push(`  Owner: ${formatAddress(asset.ownership.owner)}`);
          }
        });

        return mcpText(lines.join('\n'));
      }

      // --- Single asset mode ---
      let asset: AssetResponse | null;
      try {
        asset = await helius.getAsset({ id: id! }) as AssetResponse | null;
      } catch (err) {
        const header = `Asset ${formatAddress(id!)}`;
        return handleToolError(err, 'Error fetching asset', [
          addressError(header, 'Invalid Solana address. Please provide a valid base58-encoded mint address.'),
          notFoundError(header, 'Asset not found. This mint address does not exist or has not been indexed.'),
        ]);
      }

      if (!asset) {
        return mcpText(`Asset ${formatAddress(id!)} not found.`);
      }

      const metadata = asset.content?.metadata;
      const tokenInfo = asset.token_info;

      const lines = [
        `**Asset: ${metadata?.name || tokenInfo?.symbol || 'Unnamed'}**`,
        '',
        `**Mint Address:** ${asset.id}`,
        `**Type:** ${asset.interface}`,
      ];

      if (metadata?.symbol || tokenInfo?.symbol) {
        lines.push(`**Symbol:** ${metadata?.symbol || tokenInfo?.symbol}`);
      }

      if (asset.ownership?.owner) {
        lines.push(`**Owner:** ${formatAddress(asset.ownership.owner)}`);
      }

      if (metadata?.description) {
        lines.push(`**Description:** ${metadata.description}`);
      }

      // Creators/Deployer info
      if (asset.creators && asset.creators.length > 0) {
        lines.push('', '**Creators:**');
        asset.creators.forEach((creator) => {
          const verified = creator.verified ? '✓' : '✗';
          lines.push(`- ${formatAddress(creator.address)} (${creator.share}% share) ${verified}`);
        });
      }

      // Authorities
      if (asset.authorities && asset.authorities.length > 0) {
        lines.push('', '**Authorities:**');
        asset.authorities.forEach((auth) => {
          lines.push(`- ${formatAddress(auth.address)} [${auth.scopes.join(', ')}]`);
        });
      }

      // Token info (for fungible tokens)
      if (tokenInfo) {
        lines.push('', '**Token Info:**');
        if (tokenInfo.decimals !== undefined) {
          lines.push(`- Decimals: ${tokenInfo.decimals}`);
        }
        if (tokenInfo.supply !== undefined) {
          const formattedSupply = tokenInfo.decimals
            ? (tokenInfo.supply / Math.pow(10, tokenInfo.decimals)).toLocaleString()
            : tokenInfo.supply.toLocaleString();
          lines.push(`- Supply: ${formattedSupply}`);
        }
        if (tokenInfo.token_program) {
          const programName = tokenInfo.token_program === 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'
            ? 'SPL Token'
            : tokenInfo.token_program === 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb'
              ? 'Token-2022'
              : formatAddress(tokenInfo.token_program);
          lines.push(`- Program: ${programName}`);
        }
        if (tokenInfo.price_info?.price_per_token) {
          lines.push(`- Price: $${tokenInfo.price_info.price_per_token.toFixed(6)} ${tokenInfo.price_info.currency || 'USD'}`);
        }
      }

      if (asset.content?.links?.image) {
        lines.push(`**Image:** ${asset.content.links.image}`);
      }

      if (asset.royalty && asset.royalty.percent > 0) {
        lines.push(`**Royalty:** ${asset.royalty.percent}%`);
      }

      // Mutable/burnt status
      const flags: string[] = [];
      if (asset.mutable === false) flags.push('Immutable');
      if (asset.mutable === true) flags.push('Mutable');
      if (asset.burnt) flags.push('Burnt');
      if (flags.length > 0) {
        lines.push(`**Status:** ${flags.join(', ')}`);
      }

      return mcpText(lines.join('\n'));
    }
  );

  // Search Assets — unified search with smart routing for creator/authority/general queries
  server.tool(
    'searchAssets',
    'Advanced search for digital assets (NFTs, tokens) with multiple filters. Search by owner, creator, authority, name, compression status, burnt status, or frozen status. Also replaces getAssetsByCreator and getAssetsByAuthority — pass creatorAddress (with optional onlyVerified) to find assets by creator, or authorityAddress to find assets controlled by an authority. DAS API (10 credits/call).',
    {
      ownerAddress: z.string().optional().describe('Filter by owner wallet address'),
      creatorAddress: z.string().optional().describe('Filter by creator address'),
      authorityAddress: z.string().optional().describe('Filter by authority address (finds assets this address has update/freeze control over)'),
      onlyVerified: z.boolean().optional().default(false).describe('Only return assets where the creator is verified (used with creatorAddress)'),
      name: z.string().optional().describe('Search by asset name (partial match). Requires ownerAddress to be provided.'),
      compressed: z.boolean().optional().describe('Filter for compressed NFTs (cNFTs) only'),
      burnt: z.boolean().optional().describe('Filter by burnt status'),
      frozen: z.boolean().optional().describe('Filter by frozen status'),
      page: z.number().optional().default(1).describe('Page number (starts at 1)'),
      limit: z.number().optional().default(20).describe('Results per page (max 1000)')
    },
    async ({ ownerAddress, creatorAddress, authorityAddress, onlyVerified, name, compressed, burnt, frozen, page, limit }) => {
      if (!hasApiKey()) return noApiKeyResponse();
      const helius = getHeliusClient();

      type AssetItem = {
        id: string;
        interface: string;
        content?: { metadata?: { name?: string; symbol?: string } };
        token_info?: { symbol?: string };
        ownership?: { owner?: string };
        compression?: { compressed?: boolean };
        burnt?: boolean;
        frozen?: boolean;
      };

      type ListResponse = {
        items?: AssetItem[];
        total?: number;
      };

      let response: ListResponse;
      let headerLabel: string;

      // Smart routing: authority-only → getAssetsByAuthority
      if (authorityAddress && !creatorAddress && !ownerAddress && !name && compressed === undefined && burnt === undefined && frozen === undefined) {
        try {
          response = await helius.getAssetsByAuthority({
            authorityAddress,
            page,
            limit
          }) as ListResponse;
        } catch (err) {
          const header = `Assets by Authority ${formatAddress(authorityAddress)}`;
          return handleToolError(err, 'Error searching assets', [
            addressError(header, 'Invalid Solana address. Please provide a valid base58-encoded address.'),
            paginationError(header),
          ]);
        }
        headerLabel = `Assets by Authority ${formatAddress(authorityAddress)}`;
      }
      // Smart routing: creator (with optional onlyVerified) → getAssetsByCreator
      else if (creatorAddress && !authorityAddress && !ownerAddress && !name && compressed === undefined && burnt === undefined && frozen === undefined) {
        try {
          response = await helius.getAssetsByCreator({
            creatorAddress,
            onlyVerified,
            page,
            limit
          }) as ListResponse;
        } catch (err) {
          const header = `Assets by Creator ${formatAddress(creatorAddress)}`;
          return handleToolError(err, 'Error searching assets', [
            addressError(header, 'Invalid Solana address. Please provide a valid base58-encoded address.'),
            paginationError(header),
          ]);
        }
        headerLabel = `Assets by Creator ${formatAddress(creatorAddress)}`;
      }
      // General search → searchAssets
      else {
        if (name && !ownerAddress) {
          return mcpText(`**Search Error:** Searching by name requires an owner address. Please also provide \`ownerAddress\` to search for assets named "${name}".`);
        }

        type SearchParams = {
          page: number;
          limit: number;
          ownerAddress?: string;
          creatorAddress?: string;
          name?: string;
          compressed?: boolean;
          burnt?: boolean;
          frozen?: boolean;
        };

        const params: SearchParams = { page, limit };
        if (ownerAddress) params.ownerAddress = ownerAddress;
        if (creatorAddress) params.creatorAddress = creatorAddress;
        if (name) params.name = name;
        if (compressed !== undefined) params.compressed = compressed;
        if (burnt !== undefined) params.burnt = burnt;
        if (frozen !== undefined) params.frozen = frozen;

        try {
          response = await helius.searchAssets(params) as ListResponse;
        } catch (err) {
          return handleToolError(err, 'Error searching assets', [
            addressError('Asset Search'),
            paginationError('Asset Search'),
          ]);
        }
        headerLabel = 'Asset Search Results';
      }

      const items = (response.items || []) as AssetItem[];

      if (items.length === 0) {
        return mcpText(`**${headerLabel}**\n\nNo assets found matching the criteria.`);
      }

      const lines = [`**${headerLabel}** (${response.total || items.length} total, page ${page})`, ''];

      items.forEach((asset) => {
        const assetName = asset.content?.metadata?.name || asset.content?.metadata?.symbol || asset.token_info?.symbol || 'Unnamed';
        const assetFlags: string[] = [];
        if (asset.compression?.compressed) assetFlags.push('cNFT');
        if (asset.burnt) assetFlags.push('Burnt');
        if (asset.frozen) assetFlags.push('Frozen');
        const flagStr = assetFlags.length > 0 ? ` [${assetFlags.join(', ')}]` : '';

        lines.push(`- **${assetName}** (${asset.interface})${flagStr}`);
        lines.push(`  ID: ${formatAddress(asset.id)}`);
        if (asset.ownership?.owner) {
          lines.push(`  Owner: ${formatAddress(asset.ownership.owner)}`);
        }
      });

      return mcpText(lines.join('\n'));
    }
  );

  // Get Assets by Group (Collection)
  server.tool(
    'getAssetsByGroup',
    'Get all NFTs in a collection by group key/value. The groupKey is usually "collection" and groupValue is the collection mint address. Use this to browse all NFTs in a specific collection. DAS API (10 credits/call).',
    {
      groupKey: z.string().describe('Group key - usually "collection"'),
      groupValue: z.string().describe('Group value - usually the collection mint address'),
      page: z.number().optional().default(1).describe('Page number (starts at 1)'),
      limit: z.number().optional().default(20).describe('Results per page (max 1000)')
    },
    async ({ groupKey, groupValue, page, limit }) => {
      if (!hasApiKey()) return noApiKeyResponse();
      const helius = getHeliusClient();

      let response;
      try {
        response = await helius.getAssetsByGroup({
          groupKey,
          groupValue,
          page,
          limit
        });
      } catch (err) {
        const header = `Assets in Group ${groupKey}=${formatAddress(groupValue)}`;
        return handleToolError(err, 'Error fetching group assets', [
          addressError(header, 'Invalid Solana address. Please provide a valid base58-encoded address.'),
          paginationError(header),
        ]);
      }

      type AssetItem = {
        id: string;
        interface: string;
        content?: { metadata?: { name?: string; symbol?: string } };
        ownership?: { owner?: string };
      };

      const items = (response.items || []) as AssetItem[];

      if (items.length === 0) {
        return mcpText(`**Assets in Group ${groupKey}=${formatAddress(groupValue)}**\n\nNo assets found.`);
      }

      const lines = [`**Assets in Group ${groupKey}=${formatAddress(groupValue)}** (${response.total || items.length} total, page ${page})`, ''];

      items.forEach((asset) => {
        const assetName = asset.content?.metadata?.name || asset.content?.metadata?.symbol || 'Unnamed';
        lines.push(`- **${assetName}** (${asset.interface})`);
        lines.push(`  ID: ${formatAddress(asset.id)}`);
        if (asset.ownership?.owner) {
          lines.push(`  Owner: ${formatAddress(asset.ownership.owner)}`);
        }
      });

      return mcpText(lines.join('\n'));
    }
  );
}
