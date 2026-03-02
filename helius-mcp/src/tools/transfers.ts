import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { createKeyPairSignerFromBytes, address } from '@solana/kit';
import { getTransferSolInstruction } from '@solana-program/system';
import {
  findAssociatedTokenPda,
  getCreateAssociatedTokenIdempotentInstruction,
  getTransferCheckedInstruction,
  TOKEN_PROGRAM_ADDRESS,
} from '@solana-program/token';
import { getHeliusClient, hasApiKey, loadSignerOrFail } from '../utils/helius.js';
import { mcpText, mcpError, handleToolError, isValidAddressFormat } from '../utils/errors.js';
import { noApiKeyResponse } from './shared.js';

const TOKEN_2022_PROGRAM_ID = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';

// ── Tool Registration ──

export function registerTransferTools(server: McpServer) {

  // ── Transfer SOL ──

  server.tool(
    'transferSol',
    'BEST FOR: sending native SOL from your MCP wallet to another address. ' +
    'PREFER transferToken for SPL tokens. ' +
    'Transfers native SOL using Helius Sender for optimal landing rates. ' +
    'Requires a configured keypair (call generateKeypair if needed). ' +
    'This is an irreversible on-chain transaction. ' +
    'Credit cost: ~3 credits (CU simulation + priority fee estimate + send).',
    {
      recipientAddress: z.string().describe('Recipient Solana wallet address (base58 encoded)'),
      amount: z.number().positive().describe('Amount of SOL to send (e.g., 0.5 for half a SOL)'),
    },
    async ({ recipientAddress, amount }) => {
      if (!hasApiKey()) return noApiKeyResponse();

      try {
        // Load keypair
        let signerData: { secretKey: Uint8Array; walletAddress: string };
        try {
          signerData = await loadSignerOrFail();
        } catch {
          return mcpError(
            'No keypair found. Call `generateKeypair` first to create a wallet, then fund it before sending.'
          );
        }

        // Validate recipient address
        if (!isValidAddressFormat(recipientAddress)) {
          return mcpError(
            `Invalid recipient address "${recipientAddress}". Expected a valid Solana address (32-44 base58 characters).`
          );
        }

        // Convert SOL to lamports
        const lamports = BigInt(Math.round(amount * 1_000_000_000));

        // Create signer from keypair bytes
        const signer = await createKeyPairSignerFromBytes(signerData.secretKey);

        // Build transfer instruction
        const ix = getTransferSolInstruction({
          source: signer,
          destination: address(recipientAddress),
          amount: lamports,
        });

        // Send via Helius Sender
        const helius = getHeliusClient();
        const signature = await helius.tx.sendTransactionWithSender({
          signers: [signer],
          instructions: [ix],
          region: 'Default',
        });

        return mcpText(
          `**SOL Transfer Sent**\n\n` +
          `- **From:** \`${signerData.walletAddress}\`\n` +
          `- **To:** \`${recipientAddress}\`\n` +
          `- **Amount:** ${amount} SOL\n` +
          `- **Signature:** \`${signature}\`\n` +
          `- **Explorer:** https://solscan.io/tx/${signature}`
        );
      } catch (err) {
        return handleToolError(err, 'Error sending SOL transfer');
      }
    }
  );

  // ── Transfer SPL Token ──

  server.tool(
    'transferToken',
    'BEST FOR: sending SPL tokens (USDC, BONK, JUP, etc.) from your MCP wallet to another address. ' +
    'PREFER transferSol for native SOL. ' +
    'Automatically creates recipient token account if needed. ' +
    'Uses Helius Sender for optimal landing rates. ' +
    'Requires a configured keypair. ' +
    'This is an irreversible on-chain transaction. ' +
    'Credit cost: ~13 credits (10 DAS for mint info + ~3 for CU simulation, priority fee, send).',
    {
      recipientAddress: z.string().describe('Recipient Solana wallet address (base58 encoded)'),
      mintAddress: z.string().describe('Token mint address (base58 encoded, e.g., EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v for USDC)'),
      amount: z.number().positive().describe('Amount of tokens to send in human-readable units (e.g., 10 for 10 USDC)'),
    },
    async ({ recipientAddress, mintAddress, amount }) => {
      if (!hasApiKey()) return noApiKeyResponse();

      try {
        // Load keypair
        let signerData: { secretKey: Uint8Array; walletAddress: string };
        try {
          signerData = await loadSignerOrFail();
        } catch {
          return mcpError(
            'No keypair found. Call `generateKeypair` first to create a wallet, then fund it before sending.'
          );
        }

        // Validate addresses
        if (!isValidAddressFormat(recipientAddress)) {
          return mcpError(
            `Invalid recipient address "${recipientAddress}". Expected a valid Solana address (32-44 base58 characters).`
          );
        }
        if (!isValidAddressFormat(mintAddress)) {
          return mcpError(
            `Invalid mint address "${mintAddress}". Expected a valid Solana address (32-44 base58 characters).`
          );
        }

        // Fetch token metadata via DAS to get decimals and token program
        const helius = getHeliusClient();
        let asset: any;
        try {
          asset = await helius.getAsset({ id: mintAddress });
        } catch {
          return mcpError(
            `Could not fetch token metadata for mint \`${mintAddress}\`. Verify the mint address is correct.`
          );
        }

        if (!asset?.token_info?.decimals && asset?.token_info?.decimals !== 0) {
          return mcpError(
            `Mint \`${mintAddress}\` does not appear to be a fungible token (no decimals info found). Use \`getAsset\` to inspect it.`
          );
        }

        const decimals: number = asset.token_info.decimals;
        const tokenProgram: string | undefined = asset.token_info.token_program;
        const tokenName: string = asset.content?.metadata?.name || 'Unknown Token';
        const tokenSymbol: string = asset.content?.metadata?.symbol || '';

        // Token-2022 check
        if (tokenProgram === TOKEN_2022_PROGRAM_ID) {
          return mcpError(
            `Token-2022 transfers are not yet supported. This token (\`${tokenName}\`${tokenSymbol ? ` / ${tokenSymbol}` : ''}) uses the Token-2022 program. Standard SPL Token transfers are supported.`
          );
        }

        // Convert human-readable amount to raw amount
        const rawAmount = BigInt(Math.round(amount * 10 ** decimals));

        // Create signer from keypair bytes
        const signer = await createKeyPairSignerFromBytes(signerData.secretKey);
        const mint = address(mintAddress);
        const recipient = address(recipientAddress);

        // Derive ATAs
        const [senderAta] = await findAssociatedTokenPda({
          owner: signer.address,
          mint,
          tokenProgram: TOKEN_PROGRAM_ADDRESS,
        });
        const [recipientAta] = await findAssociatedTokenPda({
          owner: recipient,
          mint,
          tokenProgram: TOKEN_PROGRAM_ADDRESS,
        });

        // Build instructions: idempotent ATA creation + transfer
        const createAtaIx = getCreateAssociatedTokenIdempotentInstruction({
          payer: signer,
          ata: recipientAta,
          owner: recipient,
          mint,
          tokenProgram: TOKEN_PROGRAM_ADDRESS,
        });

        const transferIx = getTransferCheckedInstruction({
          source: senderAta,
          mint,
          destination: recipientAta,
          authority: signer,
          amount: rawAmount,
          decimals,
        });

        // Send via Helius Sender
        const signature = await helius.tx.sendTransactionWithSender({
          signers: [signer],
          instructions: [createAtaIx, transferIx],
          region: 'Default',
        });

        const displayName = tokenSymbol
          ? `${amount} ${tokenSymbol} (${tokenName})`
          : `${amount} ${tokenName}`;

        return mcpText(
          `**Token Transfer Sent**\n\n` +
          `- **From:** \`${signerData.walletAddress}\`\n` +
          `- **To:** \`${recipientAddress}\`\n` +
          `- **Amount:** ${displayName}\n` +
          `- **Mint:** \`${mintAddress}\`\n` +
          `- **Signature:** \`${signature}\`\n` +
          `- **Explorer:** https://solscan.io/tx/${signature}`
        );
      } catch (err) {
        return handleToolError(err, 'Error sending token transfer');
      }
    }
  );
}
