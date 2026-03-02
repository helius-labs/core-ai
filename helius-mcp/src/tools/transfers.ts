import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { createKeyPairSignerFromBytes, address } from '@solana/kit';
import { getTransferSolInstruction } from '@solana-program/system';
import {
  findAssociatedTokenPda,
  getCloseAccountInstruction,
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
    'Set sendMax to true to drain the entire SOL balance (sends balance minus transaction fees). ' +
    'Credit cost: ~3 credits (CU simulation + priority fee estimate + send).',
    {
      recipientAddress: z.string().describe('Recipient Solana wallet address (base58 encoded)'),
      amount: z.number().positive().optional().describe('Amount of SOL to send (e.g., 0.5 for half a SOL). Required unless sendMax is true.'),
      sendMax: z.boolean().optional().default(false).describe('Send the maximum possible amount (entire balance minus transaction fees). When true, amount is ignored.'),
    },
    async ({ recipientAddress, amount, sendMax }) => {
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

        const helius = getHeliusClient();
        const balanceResult = await helius.getBalance(signerData.walletAddress);
        const balanceLamports = BigInt(balanceResult.value);

        let lamports: bigint;
        let sendAmount: number;

        if (sendMax) {
          // WARNING: This assumes sendSmartTransaction with priorityFeeCap=0 produces a
          // single-signer transaction whose only lamport cost is the 5000-lamport base fee.
          // If the SDK ever adds additional signers, compute budget instructions, or other
          // lamport-consuming operations, this will under-transfer and leave a dust balance
          // (or over-transfer and fail). Verify this invariant after any SDK upgrade.
          //
          // The account must reach exactly 0 lamports — any non-zero balance below the
          // rent-exempt minimum (~0.00089 SOL) is rejected by the runtime. We cap the
          // priority fee at 0 so the total fee is deterministically 5000 lamports
          // (the base fee per signature), and transfer balance - 5000 to drain to zero.
          const txFee = 5000n;
          lamports = balanceLamports - txFee;
          if (lamports <= 0n) {
            const available = Number(balanceLamports) / 1_000_000_000;
            return mcpError(
              `Balance too low to cover the transaction fee. You have ${available} SOL.\n\n` +
              `Wallet: \`${signerData.walletAddress}\``
            );
          }
          sendAmount = Number(lamports) / 1_000_000_000;
        } else {
          if (amount === undefined) {
            return mcpError('Either `amount` must be specified or `sendMax` must be true.');
          }
          lamports = BigInt(Math.round(amount * 1_000_000_000));
          sendAmount = amount;
          // Reserve ~0.005 SOL for tx fees (priority fee + sender tip)
          const reserveLamports = 5_000_000n;
          if (balanceLamports < lamports + reserveLamports) {
            const available = Number(balanceLamports) / 1_000_000_000;
            return mcpError(
              `Insufficient SOL balance. You have ${available} SOL but need ${sendAmount} SOL plus ~0.005 SOL for transaction fees.\n\n` +
              `Wallet: \`${signerData.walletAddress}\``
            );
          }
        }

        // Create signer from keypair bytes
        const signer = await createKeyPairSignerFromBytes(signerData.secretKey);

        // Build transfer instruction
        const ix = getTransferSolInstruction({
          source: signer,
          destination: address(recipientAddress),
          amount: lamports,
        });

        let signature: string;
        if (sendMax) {
          // Use sendSmartTransaction (no sender tip) with priorityFeeCap=0 so the
          // total fee is exactly 5000 lamports, draining the account to zero.
          signature = await helius.tx.sendSmartTransaction({
            signers: [signer],
            instructions: [ix],
            priorityFeeCap: 0,
          });
        } else {
          // Use Helius Sender for optimal landing rates
          signature = await helius.tx.sendTransactionWithSender({
            signers: [signer],
            instructions: [ix],
            region: 'Default',
          });
        }

        return mcpText(
          `**SOL Transfer Sent**\n\n` +
          `- **From:** \`${signerData.walletAddress}\`\n` +
          `- **To:** \`${recipientAddress}\`\n` +
          `- **Amount:** ${sendAmount} SOL${sendMax ? ' (max)' : ''}\n` +
          `- **Signature:** \`${signature}\`\n` +
          `- **Explorer:** https://orbmarkets.io/tx/${signature}`
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
    'Set sendMax to true to send the entire token balance and close the sender token account (reclaims rent). ' +
    'Credit cost: ~13 credits (10 DAS for mint info + ~3 for CU simulation, priority fee, send).',
    {
      recipientAddress: z.string().describe('Recipient Solana wallet address (base58 encoded)'),
      mintAddress: z.string().describe('Token mint address (base58 encoded, e.g., EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v for USDC)'),
      amount: z.number().positive().optional().describe('Amount of tokens to send in human-readable units (e.g., 10 for 10 USDC). Required unless sendMax is true.'),
      sendMax: z.boolean().optional().default(false).describe('Send the entire token balance and close the sender token account to reclaim rent. When true, amount is ignored.'),
    },
    async ({ recipientAddress, mintAddress, amount, sendMax }) => {
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

        let rawAmount: bigint;
        let sendAmount: number;

        if (sendMax) {
          // Fetch full token balance for max send
          let tokenBalance;
          try {
            tokenBalance = await helius.getTokenAccountBalance(senderAta);
          } catch {
            return mcpError(
              `No token account found for ${tokenSymbol || tokenName}. You may not hold this token.\n\n` +
              `Wallet: \`${signerData.walletAddress}\`\n` +
              `Mint: \`${mintAddress}\``
            );
          }
          rawAmount = BigInt(tokenBalance.value.amount);
          if (rawAmount === 0n) {
            return mcpError(
              `${tokenSymbol || tokenName} balance is 0. Nothing to send.\n\n` +
              `Wallet: \`${signerData.walletAddress}\`\n` +
              `Mint: \`${mintAddress}\``
            );
          }
          sendAmount = Number(rawAmount) / 10 ** decimals;
        } else {
          if (amount === undefined) {
            return mcpError('Either `amount` must be specified or `sendMax` must be true.');
          }
          rawAmount = BigInt(Math.round(amount * 10 ** decimals));
          sendAmount = amount;

          // Pre-flight token balance check
          try {
            const tokenBalance = await helius.getTokenAccountBalance(senderAta);
            const currentRaw = BigInt(tokenBalance.value.amount);
            if (currentRaw < rawAmount) {
              const currentHuman = Number(currentRaw) / 10 ** decimals;
              return mcpError(
                `Insufficient ${tokenSymbol || tokenName} balance. You have ${currentHuman} but are trying to send ${sendAmount}.\n\n` +
                `Wallet: \`${signerData.walletAddress}\`\n` +
                `Mint: \`${mintAddress}\``
              );
            }
          } catch {
            // Token account may not exist yet — let the on-chain error handle it
          }
        }

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

        // When sending max, close the sender's ATA to reclaim rent
        const closeIx = sendMax
          ? getCloseAccountInstruction({
              account: senderAta,
              destination: signer.address,
              owner: signer,
            })
          : undefined;

        // Send via Helius Sender
        const signature = await helius.tx.sendTransactionWithSender({
          signers: [signer],
          instructions: closeIx
            ? [createAtaIx, transferIx, closeIx]
            : [createAtaIx, transferIx],
          region: 'Default',
        });

        const displayName = tokenSymbol
          ? `${sendAmount} ${tokenSymbol} (${tokenName})`
          : `${sendAmount} ${tokenName}`;

        return mcpText(
          `**Token Transfer Sent**\n\n` +
          `- **From:** \`${signerData.walletAddress}\`\n` +
          `- **To:** \`${recipientAddress}\`\n` +
          `- **Amount:** ${displayName}${sendMax ? ' (max)' : ''}\n` +
          `- **Mint:** \`${mintAddress}\`\n` +
          `- **Signature:** \`${signature}\`\n` +
          `- **Explorer:** https://orbmarkets.io/tx/${signature}`
        );
      } catch (err) {
        return handleToolError(err, 'Error sending token transfer');
      }
    }
  );
}
