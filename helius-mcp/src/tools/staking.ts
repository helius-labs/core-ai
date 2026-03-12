import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { createKeyPairSignerFromBytes, address } from '@solana/kit';
import { getHeliusClient, hasApiKey, loadSignerOrFail, getSessionWalletAddress } from '../utils/helius.js';
import { mcpText, mcpError, handleToolError, isValidAddressFormat } from '../utils/errors.js';
import { noApiKeyResponse } from './shared.js';

// ── Tool Registration ──

export function registerStakingTools(server: McpServer) {

  // ── Stake SOL ──

  server.tool(
    'stakeSOL',
    'BEST FOR: staking native SOL to the Helius validator to earn yield. ' +
    'PREFER getStakeAccounts to view existing stake accounts, getWithdrawableAmount to check withdrawal eligibility. ' +
    'Creates a new stake account, delegates to the Helius validator, and sends the transaction on-chain. ' +
    'Requires a configured keypair (call generateKeypair if needed). ' +
    'This is an irreversible on-chain transaction. ' +
    'The Solana runtime requires a rent-exempt reserve (~0.00228 SOL) on top of the staked amount. ' +
    'Credit cost: ~3 credits (CU simulation + priority fee estimate + send).',
    {
      amount: z.number().positive().describe(
        'Amount of SOL to stake (e.g., 1.0 for one SOL). This is the delegation amount; a small rent-exempt reserve (~0.00228 SOL) is added automatically.'
      ),
    },
    async ({ amount }) => {
      if (!hasApiKey()) return noApiKeyResponse();

      try {
        // Load keypair
        let signerData: { secretKey: Uint8Array; walletAddress: string };
        try {
          signerData = await loadSignerOrFail();
        } catch {
          return mcpError(
            'No keypair found. Call `generateKeypair` first to create a wallet, then fund it before staking.'
          );
        }

        const helius = getHeliusClient();

        // Pre-flight balance check — need amount + ~0.01 SOL for rent + fees
        const balanceResult = await helius.getBalance(signerData.walletAddress);
        const balanceLamports = BigInt(balanceResult.value);
        const stakeLamports = BigInt(Math.round(amount * 1_000_000_000));
        const reserveLamports = 10_000_000n; // ~0.01 SOL for rent-exempt reserve + fees
        if (balanceLamports < stakeLamports + reserveLamports) {
          const available = Number(balanceLamports) / 1_000_000_000;
          return mcpError(
            `Insufficient SOL balance. You have ${available} SOL but need ${amount} SOL plus ~0.01 SOL for rent-exempt reserve and transaction fees.\n\n` +
            `Wallet: \`${signerData.walletAddress}\``
          );
        }

        // Create signer from keypair bytes
        const signer = await createKeyPairSignerFromBytes(signerData.secretKey);

        // Get stake instructions (async — fetches rent-exempt minimum from RPC)
        const { instructions, stakeAccount } = await helius.stake.getStakeInstructions(signer, amount);

        // Send transaction — stakeAccount is a generated keypair that must co-sign
        const signature = await helius.tx.sendTransactionWithSender({
          signers: [signer, stakeAccount],
          instructions: [...instructions],
          region: 'Default',
        });

        return mcpText(
          `**SOL Staked to Helius Validator**\n\n` +
          `- **From:** \`${signerData.walletAddress}\`\n` +
          `- **Stake Account:** \`${stakeAccount.address}\`\n` +
          `- **Amount:** ${amount} SOL\n` +
          `- **Signature:** \`${signature}\`\n` +
          `- **Explorer:** https://orbmarkets.io/tx/${signature}\n\n` +
          `The stake account is now delegated to the Helius validator. ` +
          `Staking rewards begin accruing after the activation epoch completes (~1 epoch / 2-3 days).`
        );
      } catch (err) {
        return handleToolError(err, 'Error staking SOL');
      }
    }
  );

  // ── Unstake SOL ──

  server.tool(
    'unstakeSOL',
    'BEST FOR: deactivating (unstaking) a stake account to begin the cooldown period before withdrawal. ' +
    'PREFER getStakeAccounts to find stake account addresses first. ' +
    'Sends a deactivation transaction for the given stake account. ' +
    'After deactivation, wait ~1 full epoch (2-3 days) before funds become withdrawable. ' +
    'Use withdrawStake after cooldown completes. ' +
    'Requires a configured keypair (the stake authority). ' +
    'This is an irreversible on-chain transaction. ' +
    'Credit cost: ~3 credits.',
    {
      stakeAccount: z.string().describe(
        'Address of the stake account to deactivate (base58 encoded). Use getStakeAccounts to find your Helius stake accounts.'
      ),
    },
    async ({ stakeAccount: stakeAccountAddress }) => {
      if (!hasApiKey()) return noApiKeyResponse();

      try {
        // Load keypair
        let signerData: { secretKey: Uint8Array; walletAddress: string };
        try {
          signerData = await loadSignerOrFail();
        } catch {
          return mcpError(
            'No keypair found. Call `generateKeypair` first to create a wallet.'
          );
        }

        // Validate address
        if (!isValidAddressFormat(stakeAccountAddress)) {
          return mcpError(
            `Invalid stake account address "${stakeAccountAddress}". Expected a valid Solana address (32-44 base58 characters).`
          );
        }

        const helius = getHeliusClient();
        const signer = await createKeyPairSignerFromBytes(signerData.secretKey);

        // Get deactivation instruction (synchronous)
        const ix = helius.stake.getUnstakeInstruction(signer, address(stakeAccountAddress));

        // Send transaction
        const signature = await helius.tx.sendTransactionWithSender({
          signers: [signer],
          instructions: [ix],
          region: 'Default',
        });

        return mcpText(
          `**Stake Account Deactivated**\n\n` +
          `- **Stake Account:** \`${stakeAccountAddress}\`\n` +
          `- **Authority:** \`${signerData.walletAddress}\`\n` +
          `- **Signature:** \`${signature}\`\n` +
          `- **Explorer:** https://orbmarkets.io/tx/${signature}\n\n` +
          `The stake account is now deactivating. Funds will become withdrawable after the cooldown period (~1 full epoch / 2-3 days). ` +
          `Use \`getWithdrawableAmount\` to check when funds are ready, then \`withdrawStake\` to withdraw.`
        );
      } catch (err) {
        return handleToolError(err, 'Error deactivating stake account');
      }
    }
  );

  // ── Withdraw Stake ──

  server.tool(
    'withdrawStake',
    'BEST FOR: withdrawing SOL from a deactivated stake account back to your wallet. ' +
    'PREFER getWithdrawableAmount to check if funds are available before withdrawing. ' +
    'By default withdraws the full balance (including rent-exempt reserve) and closes the stake account. ' +
    'The stake account must be fully deactivated (cooldown complete, ~1 epoch after unstakeSOL) before withdrawal. ' +
    'Requires a configured keypair (the withdraw authority). ' +
    'This is an irreversible on-chain transaction. ' +
    'Credit cost: ~3 credits.',
    {
      stakeAccount: z.string().describe(
        'Address of the deactivated stake account to withdraw from (base58 encoded).'
      ),
      destination: z.string().optional().describe(
        'Destination wallet address to receive the withdrawn SOL (base58 encoded). Defaults to the MCP wallet address if omitted.'
      ),
      amount: z.number().positive().optional().describe(
        'Amount of SOL to withdraw. If omitted, withdraws the entire withdrawable balance (including rent-exempt reserve, which closes the account).'
      ),
    },
    async ({ stakeAccount: stakeAccountAddress, destination, amount }) => {
      if (!hasApiKey()) return noApiKeyResponse();

      try {
        // Load keypair
        let signerData: { secretKey: Uint8Array; walletAddress: string };
        try {
          signerData = await loadSignerOrFail();
        } catch {
          return mcpError(
            'No keypair found. Call `generateKeypair` first to create a wallet.'
          );
        }

        // Validate addresses
        if (!isValidAddressFormat(stakeAccountAddress)) {
          return mcpError(
            `Invalid stake account address "${stakeAccountAddress}". Expected a valid Solana address (32-44 base58 characters).`
          );
        }
        if (destination && !isValidAddressFormat(destination)) {
          return mcpError(
            `Invalid destination address "${destination}". Expected a valid Solana address (32-44 base58 characters).`
          );
        }

        const helius = getHeliusClient();
        const signer = await createKeyPairSignerFromBytes(signerData.secretKey);
        const dest = destination || signerData.walletAddress;

        // Determine lamports to withdraw
        let lamports: number;
        if (amount === undefined) {
          // Withdraw full balance including rent-exempt reserve (closes account)
          lamports = await helius.stake.getWithdrawableAmount(stakeAccountAddress, true);
        } else {
          lamports = Math.round(amount * 1_000_000_000);
        }

        if (lamports === 0) {
          return mcpError(
            `No funds available to withdraw from stake account \`${stakeAccountAddress}\`. ` +
            `The stake may still be active or in cooldown (not yet fully deactivated). ` +
            `Use \`getStakeAccounts\` to check the status.`
          );
        }

        // Get withdraw instruction (synchronous)
        const ix = helius.stake.getWithdrawInstruction(signer, address(stakeAccountAddress), address(dest), lamports);

        // Send transaction
        const signature = await helius.tx.sendTransactionWithSender({
          signers: [signer],
          instructions: [ix],
          region: 'Default',
        });

        const solAmount = lamports / 1_000_000_000;

        return mcpText(
          `**Stake Withdrawn**\n\n` +
          `- **Stake Account:** \`${stakeAccountAddress}\`\n` +
          `- **Destination:** \`${dest}\`\n` +
          `- **Amount:** ${solAmount} SOL\n` +
          `- **Signature:** \`${signature}\`\n` +
          `- **Explorer:** https://orbmarkets.io/tx/${signature}` +
          (amount === undefined ? `\n\nThe full balance was withdrawn and the stake account has been closed.` : '')
        );
      } catch (err) {
        return handleToolError(err, 'Error withdrawing stake');
      }
    }
  );

  // ── Get Stake Accounts ──

  server.tool(
    'getStakeAccounts',
    'BEST FOR: listing all stake accounts delegated to the Helius validator for a wallet. ' +
    'PREFER getWithdrawableAmount to check withdrawal eligibility for a specific stake account. ' +
    'Returns stake account addresses, delegated amounts, and activation status (active, deactivating, or inactive). ' +
    'Does not require a keypair — any wallet address can be queried. ' +
    'Credit cost: ~10 credits (getProgramAccounts).',
    {
      wallet: z.string().optional().describe(
        'Wallet address to query Helius stake accounts for (base58 encoded). Defaults to the MCP wallet if omitted and a keypair is configured.'
      ),
    },
    async ({ wallet }) => {
      if (!hasApiKey()) return noApiKeyResponse();

      try {
        // Resolve wallet address
        let walletAddress = wallet;
        if (!walletAddress) {
          walletAddress = getSessionWalletAddress() ?? undefined;
          if (!walletAddress) {
            return mcpError(
              'No wallet address provided and no keypair configured. Either pass a `wallet` address or call `generateKeypair` first.'
            );
          }
        }

        if (!isValidAddressFormat(walletAddress)) {
          return mcpError(
            `Invalid wallet address "${walletAddress}". Expected a valid Solana address (32-44 base58 characters).`
          );
        }

        const helius = getHeliusClient();
        const accounts = await helius.stake.getHeliusStakeAccounts(walletAddress);

        if (!accounts || accounts.length === 0) {
          return mcpText(
            `**No Helius Stake Accounts Found**\n\n` +
            `Wallet \`${walletAddress}\` has no stake accounts delegated to the Helius validator.\n\n` +
            `Use \`stakeSOL\` to stake SOL to the Helius validator.`
          );
        }

        const U64_MAX = '18446744073709551615';
        const lines: string[] = [`**Helius Stake Accounts for \`${walletAddress}\`**\n`];

        for (const account of accounts) {
          const pubkey = account.pubkey;
          const lamports = account.account.lamports;
          const solAmount = lamports / 1_000_000_000;
          const delegation = account.account.data?.parsed?.info?.stake?.delegation;

          let status = 'Unknown';
          let details = '';
          if (delegation) {
            const deactivationEpoch = delegation.deactivationEpoch;
            if (deactivationEpoch === U64_MAX) {
              status = 'Active';
              details = `Activation epoch: ${delegation.activationEpoch}`;
            } else {
              status = 'Deactivating';
              details = `Deactivation epoch: ${deactivationEpoch}`;
            }
          } else {
            status = 'Inactive';
          }

          lines.push(
            `### \`${pubkey}\`\n` +
            `- **Balance:** ${solAmount} SOL\n` +
            `- **Status:** ${status}\n` +
            (details ? `- **${details}**\n` : '') +
            (delegation ? `- **Delegated stake:** ${Number(delegation.stake) / 1_000_000_000} SOL\n` : '')
          );
        }

        lines.push(`---\n_${accounts.length} stake account(s) found._`);

        return mcpText(lines.join('\n'));
      } catch (err) {
        return handleToolError(err, 'Error fetching stake accounts');
      }
    }
  );

  // ── Get Withdrawable Amount ──

  server.tool(
    'getWithdrawableAmount',
    'BEST FOR: checking how much SOL can be withdrawn from a stake account. ' +
    'PREFER getStakeAccounts to find stake account addresses, withdrawStake to actually withdraw. ' +
    'Returns 0 if the stake account is still active or in cooldown (not yet withdrawable). ' +
    'Does not require a keypair. ' +
    'Credit cost: ~3 credits (getAccountInfo + getEpochInfo + getMinimumBalanceForRentExemption).',
    {
      stakeAccount: z.string().describe(
        'Stake account address to check (base58 encoded). Use getStakeAccounts to find stake account addresses.'
      ),
      includeRentExempt: z.boolean().optional().default(false).describe(
        'If true, includes the rent-exempt reserve (~0.00228 SOL) in the withdrawable amount. Withdrawing the full amount (with rent) closes the stake account.'
      ),
    },
    async ({ stakeAccount: stakeAccountAddress, includeRentExempt }) => {
      if (!hasApiKey()) return noApiKeyResponse();

      try {
        if (!isValidAddressFormat(stakeAccountAddress)) {
          return mcpError(
            `Invalid stake account address "${stakeAccountAddress}". Expected a valid Solana address (32-44 base58 characters).`
          );
        }

        const helius = getHeliusClient();
        const lamports = await helius.stake.getWithdrawableAmount(stakeAccountAddress, includeRentExempt);
        const solAmount = lamports / 1_000_000_000;

        if (lamports === 0) {
          return mcpText(
            `**Withdrawable Amount: 0 SOL**\n\n` +
            `Stake account \`${stakeAccountAddress}\` has no withdrawable funds.\n\n` +
            `This usually means the stake is still active or in the cooldown period after deactivation. ` +
            `Use \`getStakeAccounts\` to check the current status.`
          );
        }

        return mcpText(
          `**Withdrawable Amount**\n\n` +
          `- **Stake Account:** \`${stakeAccountAddress}\`\n` +
          `- **Withdrawable:** ${solAmount} SOL (${lamports.toLocaleString()} lamports)\n` +
          `- **Includes rent-exempt reserve:** ${includeRentExempt ? 'Yes (withdrawing closes the account)' : 'No'}\n\n` +
          `Use \`withdrawStake\` to withdraw these funds.`
        );
      } catch (err) {
        return handleToolError(err, 'Error checking withdrawable amount');
      }
    }
  );
}
