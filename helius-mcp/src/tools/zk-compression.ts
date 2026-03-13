import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getHeliusClient, hasApiKey } from '../utils/helius.js';
import { noApiKeyResponse } from './shared.js';
import { mcpText, handleToolError, addressError, missingParamError } from '../utils/errors.js';
import { formatSol, formatAddress } from '../utils/formatters.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const bigintReplacer = (_: string, v: any) => typeof v === 'bigint' ? Number(v) : v;

export function registerZkCompressionTools(server: McpServer) {

  // ─── Account Queries ───

  server.tool(
    'getCompressedAccount',
    'BEST FOR: fetching a single compressed account by address or hash. Returns account data, lamports, owner, tree info. Credit cost: 10 credits (ZK Compression RPC).',
    {
      address: z.string().optional().describe('Compressed account address (base58). Provide address or hash (at least one required).'),
      hash: z.string().optional().describe('Compressed account hash (base58). Provide address or hash (at least one required).'),
    },
    async ({ address, hash }) => {
      if (!hasApiKey()) return noApiKeyResponse();
      if (!address && !hash) {
        return missingParamError('getCompressedAccount', 'Provide at least one of `address` or `hash`.');
      }
      try {
        const helius = getHeliusClient();
        const result = await helius.zk.getCompressedAccount({
          address: address ?? null,
          hash,
        });
        const acct = result.value;
        if (!acct) {
          return mcpText('**Compressed Account**\n\nNo account found for the given address/hash.');
        }
        const lines = [
          `**Compressed Account** (slot ${result.context.slot})`,
          '',
          `**Address:** ${acct.address ?? 'N/A'}`,
          `**Owner:** ${acct.owner}`,
          `**Lamports:** ${formatSol(acct.lamports)} (${acct.lamports.toLocaleString()} lamports)`,
          `**Hash:** ${acct.hash}`,
          `**Tree:** ${acct.tree}`,
          `**Leaf Index:** ${acct.leafIndex}`,
          `**Seq:** ${acct.seq}`,
        ];
        if (acct.data) {
          lines.push(`**Data:** ${JSON.stringify(acct.data, bigintReplacer)}`);
        }
        return mcpText(lines.join('\n'));
      } catch (err) {
        return handleToolError(err, 'Error fetching compressed account', [
          addressError('Compressed Account', 'Invalid address or hash. Provide a valid base58-encoded value.'),
        ]);
      }
    }
  );

  server.tool(
    'getCompressedAccountsByOwner',
    'BEST FOR: listing all compressed accounts owned by a wallet. Returns paginated compressed accounts with data, lamports, tree info. Credit cost: 10 credits (ZK Compression RPC).',
    {
      owner: z.string().min(1).describe('Owner wallet address (base58)'),
      cursor: z.string().optional().describe('Pagination cursor from previous response'),
      limit: z.number().optional().default(20).describe('Max results per page (default 20)'),
    },
    async ({ owner, cursor, limit }) => {
      if (!hasApiKey()) return noApiKeyResponse();
      try {
        const helius = getHeliusClient();
        const result = await helius.zk.getCompressedAccountsByOwner({
          owner,
          cursor: cursor ?? null,
          limit: limit ?? null,
        });
        const val = result.value;
        const items = val.items ?? [];
        if (items.length === 0) {
          return mcpText(`**Compressed Accounts for ${formatAddress(owner)}**\n\nNo compressed accounts found.`);
        }
        const lines = [
          `**Compressed Accounts for ${formatAddress(owner)}** (${items.length} results, slot ${result.context.slot})`,
          '',
        ];
        items.forEach((acct: any, i: number) => {
          lines.push(`${i + 1}. **Hash:** ${acct.hash}`);
          lines.push(`   Lamports: ${acct.lamports.toLocaleString()} | Tree: ${acct.tree} | Leaf: ${acct.leafIndex}`);
        });
        if (val.cursor) {
          lines.push('', `**Next cursor:** \`${val.cursor}\``);
        }
        return mcpText(lines.join('\n'));
      } catch (err) {
        return handleToolError(err, 'Error fetching compressed accounts by owner', [
          addressError('Compressed Accounts by Owner', 'Invalid owner address. Provide a valid base58-encoded wallet address.'),
        ]);
      }
    }
  );

  server.tool(
    'getMultipleCompressedAccounts',
    'BEST FOR: batch-fetching multiple compressed accounts by addresses or hashes. Credit cost: 10 credits (ZK Compression RPC).',
    {
      addresses: z.array(z.string()).optional().describe('Array of compressed account addresses (base58). Provide addresses or hashes (at least one required).'),
      hashes: z.array(z.string()).optional().describe('Array of compressed account hashes (base58). Provide addresses or hashes (at least one required).'),
    },
    async ({ addresses, hashes }) => {
      if (!hasApiKey()) return noApiKeyResponse();
      if (!addresses?.length && !hashes?.length) {
        return missingParamError('getMultipleCompressedAccounts', 'Provide at least one of `addresses` or `hashes`.');
      }
      try {
        const helius = getHeliusClient();
        const result = await helius.zk.getMultipleCompressedAccounts({
          addresses: addresses ?? null,
          hashes: hashes ?? null,
        });
        const items = result.value.items ?? [];
        const total = items.filter((a: any) => a !== null).length;
        const lines = [
          `**Multiple Compressed Accounts** (${total} found, slot ${result.context.slot})`,
          '',
        ];
        items.forEach((acct: any, i: number) => {
          if (acct) {
            lines.push(`${i + 1}. **Hash:** ${acct.hash}`);
            lines.push(`   Owner: ${acct.owner} | Lamports: ${acct.lamports.toLocaleString()}`);
          } else {
            lines.push(`${i + 1}. _(not found)_`);
          }
        });
        return mcpText(lines.join('\n'));
      } catch (err) {
        return handleToolError(err, 'Error fetching multiple compressed accounts', [
          addressError('Multiple Compressed Accounts', 'Invalid address or hash. Provide valid base58-encoded values.'),
        ]);
      }
    }
  );

  // ─── Balance Queries ───

  server.tool(
    'getCompressedBalance',
    'BEST FOR: checking compressed SOL balance of a single account by address or hash. Credit cost: 10 credits (ZK Compression RPC).',
    {
      address: z.string().optional().describe('Compressed account address (base58). Provide address or hash (at least one required).'),
      hash: z.string().optional().describe('Compressed account hash (base58). Provide address or hash (at least one required).'),
    },
    async ({ address, hash }) => {
      if (!hasApiKey()) return noApiKeyResponse();
      if (!address && !hash) {
        return missingParamError('getCompressedBalance', 'Provide at least one of `address` or `hash`.');
      }
      try {
        const helius = getHeliusClient();
        const result = await helius.zk.getCompressedBalance({
          address: address ?? null,
          hash: hash ?? null,
        });
        const lamports = result.value;
        const label = address ? formatAddress(address) : hash!;
        return mcpText(`**Compressed Balance for ${label}** (slot ${result.context.slot})\n\n${formatSol(lamports)} (${lamports.toLocaleString()} lamports)`);
      } catch (err) {
        return handleToolError(err, 'Error fetching compressed balance', [
          addressError('Compressed Balance', 'Invalid address or hash. Provide a valid base58-encoded value.'),
        ]);
      }
    }
  );

  server.tool(
    'getCompressedBalanceByOwner',
    'BEST FOR: checking total compressed SOL balance across all accounts owned by a wallet. Credit cost: 10 credits (ZK Compression RPC).',
    {
      owner: z.string().min(1).describe('Owner wallet address (base58)'),
    },
    async ({ owner }) => {
      if (!hasApiKey()) return noApiKeyResponse();
      try {
        const helius = getHeliusClient();
        const result = await helius.zk.getCompressedBalanceByOwner({ owner });
        const lamports = result.value;
        return mcpText(`**Compressed Balance for ${formatAddress(owner)}** (slot ${result.context.slot})\n\n${formatSol(lamports)} (${lamports.toLocaleString()} lamports)`);
      } catch (err) {
        return handleToolError(err, 'Error fetching compressed balance by owner', [
          addressError('Compressed Balance by Owner', 'Invalid owner address. Provide a valid base58-encoded wallet address.'),
        ]);
      }
    }
  );

  // ─── Token Queries ───

  server.tool(
    'getCompressedMintTokenHolders',
    'BEST FOR: listing holders of a compressed token mint. Returns paginated list of owners and balances. Credit cost: 10 credits (ZK Compression RPC).',
    {
      mint: z.string().min(1).describe('Token mint address (base58)'),
      cursor: z.string().optional().describe('Pagination cursor from previous response'),
      limit: z.number().optional().default(20).describe('Max results per page (default 20)'),
    },
    async ({ mint, cursor, limit }) => {
      if (!hasApiKey()) return noApiKeyResponse();
      try {
        const helius = getHeliusClient();
        const result = await helius.zk.getCompressedMintTokenHolders({
          mint,
          cursor: cursor ?? null,
          limit: limit ?? null,
        });
        const val = result.value;
        const items = val.items ?? [];
        if (items.length === 0) {
          return mcpText(`**Compressed Token Holders for ${formatAddress(mint)}**\n\nNo holders found.`);
        }
        const lines = [
          `**Compressed Token Holders for ${formatAddress(mint)}** (${items.length} results, slot ${result.context.slot})`,
          '',
        ];
        items.forEach((holder: any, i: number) => {
          lines.push(`${i + 1}. **${formatAddress(holder.owner)}** — balance: ${holder.balance.toLocaleString()}`);
        });
        if (val.cursor) {
          lines.push('', `**Next cursor:** \`${val.cursor}\``);
        }
        return mcpText(lines.join('\n'));
      } catch (err) {
        return handleToolError(err, 'Error fetching compressed token holders', [
          addressError('Compressed Token Holders', 'Invalid mint address. Provide a valid base58-encoded token mint.'),
        ]);
      }
    }
  );

  server.tool(
    'getCompressedTokenAccountBalance',
    'BEST FOR: checking token balance of a single compressed token account by address or hash. Credit cost: 10 credits (ZK Compression RPC).',
    {
      address: z.string().optional().describe('Compressed token account address (base58). Provide address or hash (at least one required).'),
      hash: z.string().optional().describe('Compressed token account hash (base58). Provide address or hash (at least one required).'),
    },
    async ({ address, hash }) => {
      if (!hasApiKey()) return noApiKeyResponse();
      if (!address && !hash) {
        return missingParamError('getCompressedTokenAccountBalance', 'Provide at least one of `address` or `hash`.');
      }
      try {
        const helius = getHeliusClient();
        const result = await helius.zk.getCompressedTokenAccountBalance({
          address: address ?? null,
          hash: hash ?? null,
        });
        const label = address ? formatAddress(address) : hash!;
        return mcpText(`**Compressed Token Account Balance for ${label}** (slot ${result.context.slot})\n\n**Amount:** ${result.value.amount.toLocaleString()}`);
      } catch (err) {
        return handleToolError(err, 'Error fetching compressed token account balance', [
          addressError('Compressed Token Account Balance', 'Invalid address or hash. Provide a valid base58-encoded value.'),
        ]);
      }
    }
  );

  server.tool(
    'getCompressedTokenAccountsByOwner',
    'BEST FOR: listing compressed token accounts owned by a wallet, optionally filtered by mint. Returns account data with token info. Credit cost: 10 credits (ZK Compression RPC).',
    {
      owner: z.string().min(1).describe('Owner wallet address (base58)'),
      mint: z.string().optional().describe('Optional token mint to filter by (base58)'),
      cursor: z.string().optional().describe('Pagination cursor from previous response'),
      limit: z.number().optional().default(20).describe('Max results per page (default 20)'),
    },
    async ({ owner, mint, cursor, limit }) => {
      if (!hasApiKey()) return noApiKeyResponse();
      try {
        const helius = getHeliusClient();
        const result = await helius.zk.getCompressedTokenAccountsByOwner({
          owner,
          mint: mint ?? null,
          cursor: cursor ?? null,
          limit: limit ?? null,
        });
        const val = result.value;
        const items = val.items ?? [];
        if (items.length === 0) {
          return mcpText(`**Compressed Token Accounts for ${formatAddress(owner)}**\n\nNo compressed token accounts found.`);
        }
        const lines = [
          `**Compressed Token Accounts for ${formatAddress(owner)}** (${items.length} results, slot ${result.context.slot})`,
          '',
        ];
        items.forEach((item: any, i: number) => {
          const td = item.tokenData;
          lines.push(`${i + 1}. **Mint:** ${formatAddress(td.mint)}`);
          lines.push(`   Amount: ${td.amount.toLocaleString()} | Delegate: ${td.delegate ?? 'none'} | State: ${td.state}`);
          lines.push(`   Hash: ${item.account.hash}`);
        });
        if (val.cursor) {
          lines.push('', `**Next cursor:** \`${val.cursor}\``);
        }
        return mcpText(lines.join('\n'));
      } catch (err) {
        return handleToolError(err, 'Error fetching compressed token accounts by owner', [
          addressError('Compressed Token Accounts by Owner', 'Invalid owner or mint address. Provide valid base58-encoded addresses.'),
        ]);
      }
    }
  );

  server.tool(
    'getCompressedTokenAccountsByDelegate',
    'BEST FOR: listing compressed token accounts delegated to an address, optionally filtered by mint. Credit cost: 10 credits (ZK Compression RPC).',
    {
      delegate: z.string().min(1).describe('Delegate wallet address (base58)'),
      mint: z.string().optional().describe('Optional token mint to filter by (base58)'),
      cursor: z.string().optional().describe('Pagination cursor from previous response'),
      limit: z.number().optional().default(20).describe('Max results per page (default 20)'),
    },
    async ({ delegate, mint, cursor, limit }) => {
      if (!hasApiKey()) return noApiKeyResponse();
      try {
        const helius = getHeliusClient();
        const result = await helius.zk.getCompressedTokenAccountsByDelegate({
          delegate,
          mint: mint ?? null,
          cursor: cursor ?? null,
          limit: limit ?? null,
        });
        const val = result.value;
        const items = val.items ?? [];
        if (items.length === 0) {
          return mcpText(`**Compressed Token Accounts for Delegate ${formatAddress(delegate)}**\n\nNo compressed token accounts found.`);
        }
        const lines = [
          `**Compressed Token Accounts for Delegate ${formatAddress(delegate)}** (${items.length} results, slot ${result.context.slot})`,
          '',
        ];
        items.forEach((item: any, i: number) => {
          const td = item.tokenData;
          lines.push(`${i + 1}. **Mint:** ${formatAddress(td.mint)}`);
          lines.push(`   Amount: ${td.amount.toLocaleString()} | Owner: ${td.owner} | State: ${td.state}`);
          lines.push(`   Hash: ${item.account.hash}`);
        });
        if (val.cursor) {
          lines.push('', `**Next cursor:** \`${val.cursor}\``);
        }
        return mcpText(lines.join('\n'));
      } catch (err) {
        return handleToolError(err, 'Error fetching compressed token accounts by delegate', [
          addressError('Compressed Token Accounts by Delegate', 'Invalid delegate or mint address. Provide valid base58-encoded addresses.'),
        ]);
      }
    }
  );

  server.tool(
    'getCompressedTokenBalancesByOwnerV2',
    'BEST FOR: summarizing compressed token balances per mint for a wallet. Returns mint addresses and raw balances. Credit cost: 10 credits (ZK Compression RPC).',
    {
      owner: z.string().min(1).describe('Owner wallet address (base58)'),
      mint: z.string().optional().describe('Optional token mint to filter by (base58)'),
      cursor: z.string().optional().describe('Pagination cursor from previous response'),
      limit: z.number().optional().default(20).describe('Max results per page (default 20)'),
    },
    async ({ owner, mint, cursor, limit }) => {
      if (!hasApiKey()) return noApiKeyResponse();
      try {
        const helius = getHeliusClient();
        const result = await helius.zk.getCompressedTokenBalancesByOwnerV2({
          owner,
          mint: mint ?? null,
          cursor: cursor ?? null,
          limit: limit ?? null,
        });
        const val = result.value;
        const items = val.items ?? [];
        if (items.length === 0) {
          return mcpText(`**Compressed Token Balances for ${formatAddress(owner)}**\n\nNo compressed token balances found.`);
        }
        const lines = [
          `**Compressed Token Balances for ${formatAddress(owner)}** (${items.length} results, slot ${result.context.slot})`,
          '',
        ];
        items.forEach((tb: any, i: number) => {
          lines.push(`${i + 1}. **Mint:** ${formatAddress(tb.mint)} — balance: ${tb.balance.toLocaleString()}`);
        });
        if (val.cursor) {
          lines.push('', `**Next cursor:** \`${val.cursor}\``);
        }
        return mcpText(lines.join('\n'));
      } catch (err) {
        return handleToolError(err, 'Error fetching compressed token balances by owner', [
          addressError('Compressed Token Balances by Owner', 'Invalid owner or mint address. Provide valid base58-encoded addresses.'),
        ]);
      }
    }
  );

  // ─── Merkle Proof Queries ───

  server.tool(
    'getCompressedAccountProof',
    'BEST FOR: getting Merkle proof for a compressed account. Required for building ZK Compression transactions. Credit cost: 10 credits (ZK Compression RPC).',
    {
      hash: z.string().min(1).describe('Compressed account hash (base58, 32-byte leaf hash)'),
    },
    async ({ hash }) => {
      if (!hasApiKey()) return noApiKeyResponse();
      try {
        const helius = getHeliusClient();
        const result = await helius.zk.getCompressedAccountProof({ hash });
        const proof = result.value;
        const lines = [
          `**Compressed Account Proof** (slot ${result.context.slot})`,
          '',
          `**Hash:** ${proof.hash}`,
          `**Merkle Tree:** ${proof.merkleTree}`,
          `**Root:** ${proof.root}`,
          `**Root Seq:** ${Number(proof.rootSeq)}`,
          `**Leaf Index:** ${proof.leafIndex}`,
          `**Proof Length:** ${proof.proof.length} nodes`,
        ];
        return mcpText(lines.join('\n'));
      } catch (err) {
        return handleToolError(err, 'Error fetching compressed account proof', [
          addressError('Compressed Account Proof', 'Invalid hash. Provide a valid base58-encoded 32-byte leaf hash.'),
        ]);
      }
    }
  );

  server.tool(
    'getMultipleCompressedAccountProofs',
    'BEST FOR: batch Merkle proofs for multiple compressed accounts. Credit cost: 10 credits (ZK Compression RPC).',
    {
      hashes: z.array(z.string().min(1)).describe('Array of compressed account hashes (base58, 32-byte leaf hashes)'),
    },
    async ({ hashes }) => {
      if (!hasApiKey()) return noApiKeyResponse();
      try {
        const helius = getHeliusClient();
        // SDK takes a bare string[] for this method
        const result = await helius.zk.getMultipleCompressedAccountProofs(hashes);
        const proofs = result.value ?? [];
        const lines = [
          `**Multiple Compressed Account Proofs** (${proofs.length} proofs, slot ${result.context.slot})`,
          '',
        ];
        proofs.forEach((proof: any, i: number) => {
          lines.push(`${i + 1}. **Hash:** ${proof.hash}`);
          lines.push(`   Tree: ${proof.merkleTree} | Root Seq: ${Number(proof.rootSeq)} | Proof: ${proof.proof.length} nodes`);
        });
        return mcpText(lines.join('\n'));
      } catch (err) {
        return handleToolError(err, 'Error fetching multiple compressed account proofs', [
          addressError('Multiple Compressed Account Proofs', 'Invalid hash(es). Provide valid base58-encoded 32-byte leaf hashes.'),
        ]);
      }
    }
  );

  server.tool(
    'getMultipleNewAddressProofs',
    'BEST FOR: getting non-inclusion proofs for new addresses with specific Merkle trees. Required for creating new compressed accounts. Credit cost: 10 credits (ZK Compression RPC).',
    {
      addresses: z.array(z.object({
        address: z.string().min(1).describe('New address to prove non-inclusion (base58)'),
        tree: z.string().min(1).describe('Merkle tree address (base58)'),
      })).describe('Array of address-tree pairs'),
    },
    async ({ addresses }) => {
      if (!hasApiKey()) return noApiKeyResponse();
      try {
        const helius = getHeliusClient();
        // SDK takes a bare AddressWithTree[] for this method
        const result = await helius.zk.getMultipleNewAddressProofsV2(addresses);
        const proofs = result.value ?? [];
        const lines = [
          `**Multiple New Address Proofs** (${proofs.length} proofs, slot ${result.context.slot})`,
          '',
        ];
        proofs.forEach((proof: any, i: number) => {
          lines.push(`${i + 1}. **Address:** ${addresses[i]?.address ?? 'N/A'}`);
          lines.push(`   Tree: ${proof.merkleTree} | Root: ${proof.root} | Root Seq: ${Number(proof.rootSeq)}`);
        });
        return mcpText(lines.join('\n'));
      } catch (err) {
        return handleToolError(err, 'Error fetching new address proofs', [
          addressError('New Address Proofs', 'Invalid address or tree. Provide valid base58-encoded addresses.'),
        ]);
      }
    }
  );

  // ─── Signature Queries ───

  server.tool(
    'getCompressionSignaturesForAccount',
    'BEST FOR: getting compression transaction signatures for a specific compressed account by hash. Credit cost: 10 credits (ZK Compression RPC).',
    {
      hash: z.string().min(1).describe('Compressed account hash (base58, 32-byte leaf hash)'),
    },
    async ({ hash }) => {
      if (!hasApiKey()) return noApiKeyResponse();
      try {
        const helius = getHeliusClient();
        const result = await helius.zk.getCompressionSignaturesForAccount({ hash });
        const items = result.value.items ?? [];
        if (items.length === 0) {
          return mcpText(`**Compression Signatures for Account ${hash}**\n\nNo signatures found.`);
        }
        const lines = [
          `**Compression Signatures for Account** (${items.length} results, slot ${result.context.slot})`,
          '',
        ];
        items.forEach((sig: any, i: number) => {
          lines.push(`${i + 1}. \`${sig.signature}\``);
          if (sig.slot) lines.push(`   Slot: ${sig.slot}`);
          if (sig.blockTime) lines.push(`   Time: ${new Date(sig.blockTime * 1000).toISOString()}`);
        });
        return mcpText(lines.join('\n'));
      } catch (err) {
        return handleToolError(err, 'Error fetching compression signatures for account', [
          addressError('Compression Signatures for Account', 'Invalid hash. Provide a valid base58-encoded 32-byte leaf hash.'),
        ]);
      }
    }
  );

  server.tool(
    'getCompressionSignaturesForAddress',
    'BEST FOR: getting compression transaction signatures for a specific address. Returns paginated results. Credit cost: 10 credits (ZK Compression RPC).',
    {
      address: z.string().min(1).describe('Compressed account address (base58)'),
      cursor: z.string().optional().describe('Pagination cursor from previous response'),
      limit: z.number().optional().default(20).describe('Max results per page (default 20)'),
    },
    async ({ address, cursor, limit }) => {
      if (!hasApiKey()) return noApiKeyResponse();
      try {
        const helius = getHeliusClient();
        const result = await helius.zk.getCompressionSignaturesForAddress({
          address,
          cursor: cursor ?? null,
          limit: limit ?? null,
        });
        const val = result.value;
        const items = val.items ?? [];
        if (items.length === 0) {
          return mcpText(`**Compression Signatures for ${formatAddress(address)}**\n\nNo signatures found.`);
        }
        const lines = [
          `**Compression Signatures for ${formatAddress(address)}** (${items.length} results, slot ${result.context.slot})`,
          '',
        ];
        items.forEach((sig: any, i: number) => {
          lines.push(`${i + 1}. \`${sig.signature}\``);
          if (sig.slot) lines.push(`   Slot: ${sig.slot}`);
          if (sig.blockTime) lines.push(`   Time: ${new Date(sig.blockTime * 1000).toISOString()}`);
        });
        if (val.cursor) {
          lines.push('', `**Next cursor:** \`${val.cursor}\``);
        }
        return mcpText(lines.join('\n'));
      } catch (err) {
        return handleToolError(err, 'Error fetching compression signatures for address', [
          addressError('Compression Signatures for Address', 'Invalid address. Provide a valid base58-encoded address.'),
        ]);
      }
    }
  );

  server.tool(
    'getCompressionSignaturesForOwner',
    'BEST FOR: getting all compression transaction signatures for a wallet owner. Returns paginated results. Credit cost: 10 credits (ZK Compression RPC).',
    {
      owner: z.string().min(1).describe('Owner wallet address (base58)'),
      cursor: z.string().optional().describe('Pagination cursor from previous response'),
      limit: z.number().optional().default(20).describe('Max results per page (default 20)'),
    },
    async ({ owner, cursor, limit }) => {
      if (!hasApiKey()) return noApiKeyResponse();
      try {
        const helius = getHeliusClient();
        const result = await helius.zk.getCompressionSignaturesForOwner({
          owner,
          cursor: cursor ?? null,
          limit: limit ?? null,
        });
        const val = result.value;
        const items = val.items ?? [];
        if (items.length === 0) {
          return mcpText(`**Compression Signatures for Owner ${formatAddress(owner)}**\n\nNo signatures found.`);
        }
        const lines = [
          `**Compression Signatures for Owner ${formatAddress(owner)}** (${items.length} results, slot ${result.context.slot})`,
          '',
        ];
        items.forEach((sig: any, i: number) => {
          lines.push(`${i + 1}. \`${sig.signature}\``);
          if (sig.slot) lines.push(`   Slot: ${sig.slot}`);
          if (sig.blockTime) lines.push(`   Time: ${new Date(sig.blockTime * 1000).toISOString()}`);
        });
        if (val.cursor) {
          lines.push('', `**Next cursor:** \`${val.cursor}\``);
        }
        return mcpText(lines.join('\n'));
      } catch (err) {
        return handleToolError(err, 'Error fetching compression signatures for owner', [
          addressError('Compression Signatures for Owner', 'Invalid owner address. Provide a valid base58-encoded wallet address.'),
        ]);
      }
    }
  );

  server.tool(
    'getCompressionSignaturesForTokenOwner',
    'BEST FOR: getting compression transaction signatures specifically for token operations by a wallet owner. Credit cost: 10 credits (ZK Compression RPC).',
    {
      owner: z.string().min(1).describe('Token owner wallet address (base58)'),
      cursor: z.string().optional().describe('Pagination cursor from previous response'),
      limit: z.number().optional().default(20).describe('Max results per page (default 20)'),
    },
    async ({ owner, cursor, limit }) => {
      if (!hasApiKey()) return noApiKeyResponse();
      try {
        const helius = getHeliusClient();
        const result = await helius.zk.getCompressionSignaturesForTokenOwner({
          owner,
          cursor: cursor ?? null,
          limit: limit ?? null,
        });
        const val = result.value;
        const items = val.items ?? [];
        if (items.length === 0) {
          return mcpText(`**Compression Token Signatures for ${formatAddress(owner)}**\n\nNo signatures found.`);
        }
        const lines = [
          `**Compression Token Signatures for ${formatAddress(owner)}** (${items.length} results, slot ${result.context.slot})`,
          '',
        ];
        items.forEach((sig: any, i: number) => {
          lines.push(`${i + 1}. \`${sig.signature}\``);
          if (sig.slot) lines.push(`   Slot: ${sig.slot}`);
          if (sig.blockTime) lines.push(`   Time: ${new Date(sig.blockTime * 1000).toISOString()}`);
        });
        if (val.cursor) {
          lines.push('', `**Next cursor:** \`${val.cursor}\``);
        }
        return mcpText(lines.join('\n'));
      } catch (err) {
        return handleToolError(err, 'Error fetching compression signatures for token owner', [
          addressError('Compression Token Signatures', 'Invalid owner address. Provide a valid base58-encoded wallet address.'),
        ]);
      }
    }
  );

  server.tool(
    'getLatestCompressionSignatures',
    'BEST FOR: getting the most recent compression transactions across the network. Credit cost: 10 credits (ZK Compression RPC).',
    {
      cursor: z.string().optional().describe('Pagination cursor from previous response'),
      limit: z.number().optional().default(20).describe('Max results per page (default 20)'),
    },
    async ({ cursor, limit }) => {
      if (!hasApiKey()) return noApiKeyResponse();
      try {
        const helius = getHeliusClient();
        const result = await helius.zk.getLatestCompressionSignatures({
          cursor: cursor ?? null,
          limit: limit ?? null,
        });
        const val = result.value;
        const items = val.items ?? [];
        if (items.length === 0) {
          return mcpText('**Latest Compression Signatures**\n\nNo signatures found.');
        }
        const lines = [
          `**Latest Compression Signatures** (${items.length} results, slot ${result.context.slot})`,
          '',
        ];
        items.forEach((sig: any, i: number) => {
          lines.push(`${i + 1}. \`${sig.signature}\``);
          if (sig.slot) lines.push(`   Slot: ${sig.slot}`);
          if (sig.blockTime) lines.push(`   Time: ${new Date(sig.blockTime * 1000).toISOString()}`);
        });
        if (val.cursor) {
          lines.push('', `**Next cursor:** \`${val.cursor}\``);
        }
        return mcpText(lines.join('\n'));
      } catch (err) {
        return handleToolError(err, 'Error fetching latest compression signatures');
      }
    }
  );

  server.tool(
    'getLatestNonVotingSignatures',
    'BEST FOR: getting the most recent non-voting compression transactions across the network. Credit cost: 10 credits (ZK Compression RPC).',
    {
      cursor: z.string().optional().describe('Pagination cursor from previous response'),
      limit: z.number().optional().default(20).describe('Max results per page (default 20)'),
    },
    async ({ cursor, limit }) => {
      if (!hasApiKey()) return noApiKeyResponse();
      try {
        const helius = getHeliusClient();
        const result = await helius.zk.getLatestNonVotingSignatures({
          cursor: cursor ?? null,
          limit: limit ?? null,
        });
        const val = result.value;
        const items = val.items ?? [];
        if (items.length === 0) {
          return mcpText('**Latest Non-Voting Signatures**\n\nNo signatures found.');
        }
        const lines = [
          `**Latest Non-Voting Signatures** (${items.length} results, slot ${result.context.slot})`,
          '',
        ];
        items.forEach((sig: any, i: number) => {
          let line = `${i + 1}. \`${sig.signature}\``;
          lines.push(line);
          if (sig.slot) lines.push(`   Slot: ${sig.slot}`);
          if (sig.blockTime) lines.push(`   Time: ${new Date(sig.blockTime * 1000).toISOString()}`);
          if (sig.error) lines.push(`   **Error:** ${sig.error}`);
        });
        if (val.cursor) {
          lines.push('', `**Next cursor:** \`${val.cursor}\``);
        }
        return mcpText(lines.join('\n'));
      } catch (err) {
        return handleToolError(err, 'Error fetching latest non-voting signatures');
      }
    }
  );

  // ─── Transaction ───

  server.tool(
    'getTransactionWithCompressionInfo',
    'BEST FOR: inspecting a transaction\'s compression state changes — accounts opened and closed. Credit cost: 10 credits (ZK Compression RPC).',
    {
      signature: z.string().min(1).describe('Transaction signature (base58)'),
    },
    async ({ signature }) => {
      if (!hasApiKey()) return noApiKeyResponse();
      try {
        const helius = getHeliusClient();
        const result = await helius.zk.getTransactionWithCompressionInfo({ signature });
        if (!result) {
          return mcpText(`**Transaction ${signature}**\n\nTransaction not found or has no compression info.`);
        }
        const info = result.compression_info;
        const lines = [
          `**Transaction with Compression Info**`,
          '',
          `**Signature:** \`${signature}\``,
        ];
        if (info) {
          const opened = info.openedAccounts ?? [];
          const closed = info.closedAccounts ?? [];
          lines.push(`**Opened Accounts:** ${opened.length}`);
          opened.forEach((acct: any, i: number) => {
            lines.push(`  ${i + 1}. Owner: ${acct.account?.owner ?? 'N/A'} | Lamports: ${acct.account?.lamports?.toLocaleString() ?? 0}`);
            if (acct.optionalTokenData) {
              lines.push(`     Token: mint=${acct.optionalTokenData.mint}, amount=${acct.optionalTokenData.amount}`);
            }
          });
          lines.push(`**Closed Accounts:** ${closed.length}`);
          closed.forEach((acct: any, i: number) => {
            lines.push(`  ${i + 1}. Owner: ${acct.account?.owner ?? 'N/A'} | Lamports: ${acct.account?.lamports?.toLocaleString() ?? 0}`);
            if (acct.optionalTokenData) {
              lines.push(`     Token: mint=${acct.optionalTokenData.mint}, amount=${acct.optionalTokenData.amount}`);
            }
          });
        } else {
          lines.push('No compression info available for this transaction.');
        }
        return mcpText(lines.join('\n'));
      } catch (err) {
        return handleToolError(err, 'Error fetching transaction with compression info', [
          addressError('Transaction with Compression Info', 'Invalid transaction signature. Provide a valid base58-encoded signature.'),
        ]);
      }
    }
  );

  // ─── Validity Proof ───

  server.tool(
    'getValidityProof',
    'BEST FOR: generating a ZK validity proof for compressed account operations. Required for building transactions that modify compressed state. Credit cost: 10 credits (ZK Compression RPC).',
    {
      hashes: z.array(z.string()).optional().describe('Compressed account hashes to prove (base58). Provide hashes and/or newAddressesWithTrees.'),
      newAddressesWithTrees: z.array(z.object({
        address: z.string().min(1).describe('New address (base58)'),
        tree: z.string().min(1).describe('Merkle tree address (base58)'),
      })).optional().describe('New address-tree pairs for non-inclusion proofs'),
    },
    async ({ hashes, newAddressesWithTrees }) => {
      if (!hasApiKey()) return noApiKeyResponse();
      if (!hashes?.length && !newAddressesWithTrees?.length) {
        return missingParamError('getValidityProof', 'Provide at least one of `hashes` or `newAddressesWithTrees`.');
      }
      try {
        const helius = getHeliusClient();
        const result = await helius.zk.getValidityProof({
          hashes: hashes ?? null,
          newAddressesWithTrees: newAddressesWithTrees ?? null,
        });
        const val = result.value;
        const lines = [
          `**Validity Proof** (slot ${result.context.slot})`,
          '',
          `**Compressed Proof:**`,
          `  a: ${val.compressedProof.a}`,
          `  b: ${val.compressedProof.b}`,
          `  c: ${val.compressedProof.c}`,
          `**Leaves:** ${val.leaves.length}`,
          `**Merkle Trees:** ${val.merkleTrees.length}`,
          `**Root Indices:** ${JSON.stringify(val.rootIndices, bigintReplacer)}`,
        ];
        return mcpText(lines.join('\n'));
      } catch (err) {
        return handleToolError(err, 'Error fetching validity proof', [
          addressError('Validity Proof', 'Invalid hash or address. Provide valid base58-encoded values.'),
        ]);
      }
    }
  );

  // ─── Indexer Health ───

  server.tool(
    'getIndexerHealth',
    'BEST FOR: checking if the ZK Compression indexer is healthy and responsive. Credit cost: 10 credits (ZK Compression RPC).',
    {},
    async () => {
      if (!hasApiKey()) return noApiKeyResponse();
      try {
        const helius = getHeliusClient();
        const result = await helius.zk.getIndexerHealth();
        return mcpText(`**ZK Compression Indexer Health**\n\nStatus: **${result}**`);
      } catch (err) {
        return handleToolError(err, 'Error checking indexer health');
      }
    }
  );

  server.tool(
    'getIndexerSlot',
    'BEST FOR: checking the latest slot processed by the ZK Compression indexer. Useful for monitoring indexer lag. Credit cost: 10 credits (ZK Compression RPC).',
    {},
    async () => {
      if (!hasApiKey()) return noApiKeyResponse();
      try {
        const helius = getHeliusClient();
        const result = await helius.zk.getIndexerSlot();
        return mcpText(`**ZK Compression Indexer Slot**\n\nLatest indexed slot: **${result.toLocaleString()}**`);
      } catch (err) {
        return handleToolError(err, 'Error fetching indexer slot');
      }
    }
  );
}
