/**
 * Open Wallet Standard (OWS) integration.
 *
 * Provides an optional, additive signing path that delegates to the `ows` CLI
 * for policy-gated, key-isolated transaction signing.  When an `owsWallet`
 * parameter is supplied, transfers and staking tools use an OWS-backed signer
 * instead of the local keypair.  If OWS is not installed, callers get a clear
 * error — existing keypair flows are unaffected.
 *
 * The adapter implements the same duck-typed signer interface that @solana/kit
 * expects ({ address, signTransactions, signMessages }), so it plugs directly
 * into the Helius SDK's sendTransactionWithSender / sendSmartTransaction
 * without losing priority-fee estimation, SWQoS routing, or Jito tips.
 *
 * NOTE: The CLI helpers (isOwsInstalled, getOwsSolanaAddress) are mirrored in
 * helius-cli/src/lib/ows.ts.  Keep the two copies in sync when changing
 * argument handling, CAIP-2 lookup logic, or OWS CLI flags.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { address, createKeyPairSignerFromBytes, type Address } from '@solana/kit';
import { loadSignerOrFail, getNetwork } from './helius.js';
import { mcpError } from './errors.js';
import { isSharedCredentialMode, sharedCredentialRefusal, SHARED_CREDENTIAL_META } from './runtime.js';

const execFileAsync = promisify(execFile);

// CAIP-2 chain identifiers for Solana networks.
// See OWS spec 07-supported-chains.md.
const SOLANA_CAIP2_MAINNET = 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp';
const SOLANA_CAIP2_DEVNET = 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG';

/** Alphanumeric, hyphens, and underscores — matches OWS wallet naming rules. */
const WALLET_NAME_RE = /^[a-zA-Z0-9_-]{1,64}$/;

// ── CLI helpers ──

/**
 * True when the `ows` binary is reachable on PATH.
 */
export async function isOwsInstalled(): Promise<boolean> {
  try {
    await execFileAsync('ows', ['--version'], { timeout: 5_000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Validate wallet name format before passing to execFile.
 * While execFile prevents shell injection, a garbage name produces
 * confusing OWS CLI errors — better to catch it early.
 */
function validateWalletName(name: string): void {
  if (!WALLET_NAME_RE.test(name)) {
    throw new Error(
      `Invalid OWS wallet name "${name}". ` +
      `Names must be 1-64 characters using letters, digits, hyphens, or underscores.`,
    );
  }
}

/**
 * Return the Solana address for the named OWS wallet.
 * Uses the current MCP session network (mainnet or devnet) to select
 * the correct CAIP-2 chain key.
 */
export async function getOwsSolanaAddress(walletName: string): Promise<string> {
  validateWalletName(walletName);

  const { stdout } = await execFileAsync(
    'ows',
    ['wallet', 'info', '--wallet', walletName, '--json'],
    { timeout: 10_000 },
  );
  const info = JSON.parse(stdout);

  // The CLI outputs accounts keyed by CAIP-2 chain id.
  // Pick the key matching the active network.
  const network = getNetwork();
  const primaryKey = network === 'devnet' ? SOLANA_CAIP2_DEVNET : SOLANA_CAIP2_MAINNET;
  const account =
    info.accounts?.[primaryKey] ??
    info.accounts?.solana ??
    // Fallback: scan for any key containing "solana"
    Object.entries(info.accounts ?? {}).find(([k]) => k.includes('solana'))?.[1];

  if (!account) {
    throw new Error(
      `OWS wallet "${walletName}" has no Solana account.  ` +
      `Run \`ows wallet info --wallet ${walletName}\` to inspect.`,
    );
  }

  // Account may be a string (address) or an object with an address field.
  const addr: string = typeof account === 'string' ? account : account.address;
  if (!addr) {
    throw new Error(`Could not extract Solana address from OWS wallet "${walletName}".`);
  }
  return addr;
}

/**
 * Sign raw message bytes via OWS.  Returns the 64-byte Ed25519 signature.
 * Assumes walletName was already validated by the caller (createOwsSigner).
 */
async function owsSignBytes(walletName: string, messageHex: string): Promise<Uint8Array> {
  const { stdout } = await execFileAsync(
    'ows',
    ['sign', 'message', '--wallet', walletName, '--chain', 'solana', '--message', messageHex, '--encoding', 'hex', '--json'],
    { timeout: 30_000 },
  );
  const result = JSON.parse(stdout);
  const sigHex: string = result.signature;
  if (!sigHex) {
    throw new Error('OWS sign returned no signature');
  }
  return Uint8Array.from(Buffer.from(sigHex, 'hex'));
}

// ── Signer adapter ──

/**
 * A duck-typed @solana/kit TransactionPartialSigner backed by OWS.
 *
 * Passes `isTransactionSigner()` checks and works with
 * `setTransactionMessageFeePayerSigner`, `signTransactionMessageWithSigners`,
 * `sendTransactionWithSender`, and `sendSmartTransaction`.
 *
 * IMPORTANT: `signTransactions` and `signMessages` return **partial signature
 * maps** (`{ [address]: signatureBytes }`), NOT full transaction/message objects.
 * This matches the contract that `@solana/kit`'s `signTransactionMessageWithSigners`
 * expects — it merges the partial maps back into the compiled transaction itself.
 */
export interface OwsSigner {
  address: Address;
  signTransactions: (
    transactions: readonly { messageBytes: Uint8Array }[],
  ) => Promise<readonly Record<string, Uint8Array>[]>;
  signMessages: (
    messages: readonly { content: Uint8Array }[],
  ) => Promise<readonly Record<string, Uint8Array>[]>;
}

// ── Shared signer resolution ──

/**
 * Resolve a signer from an OWS wallet name or the local Helius keypair.
 * Returns a result-union so callers can return the MCP error directly.
 *
 * The returned `signer` is typed as `any` to avoid @solana/kit branded-type
 * friction — it satisfies `isTransactionSigner()` at runtime.
 *
 * ⚠ If @solana/kit changes its signer interface (signTransactions /
 * signMessages argument or return shapes), these casts will pass type-checking
 * but fail at runtime.  After any @solana/kit upgrade, verify the OWS signer
 * still passes `isTransactionSigner()` and produces valid signatures in the
 * full `signTransactionMessageWithSigners` pipeline.
 */
export async function resolveOwsOrKeypairSigner(owsWallet?: string): Promise<
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  | { ok: true; signer: any; walletAddress: string; owsWallet?: string }
  | { ok: false; error: ReturnType<typeof mcpError> }
> {
  // Ahead of both branches: the OWS path shells out to a wallet CLI on the host,
  // and the fallback path loads a keypair from the host's disk. Neither is a
  // per-caller wallet, so neither belongs on a server serving many callers.
  // Checked here rather than relying on loadSignerOrFail throwing, because the
  // catch below flattens every failure into "call generateKeypair" — which in
  // shared mode is advice that also refuses.
  if (isSharedCredentialMode()) {
    return { ok: false, error: mcpError(
      sharedCredentialRefusal('Transaction signing'),
      SHARED_CREDENTIAL_META,
    ) };
  }

  if (owsWallet) {
    if (!WALLET_NAME_RE.test(owsWallet)) {
      return { ok: false, error: mcpError(
        `Invalid OWS wallet name "${owsWallet}". Names must be 1-64 characters using letters, digits, hyphens, or underscores.`,
        { type: 'VALIDATION', code: 'INVALID_WALLET_NAME', retryable: false, recovery: 'Provide a valid wallet name (letters, digits, hyphens, underscores).' },
      ) };
    }
    if (!await isOwsInstalled()) {
      return { ok: false, error: mcpError(
        'OWS CLI is not installed. Install it with `curl -fsSL https://docs.openwallet.sh/install.sh | bash` or `npm install -g @open-wallet-standard/core`.',
        { type: 'AUTH', code: 'OWS_NOT_INSTALLED', retryable: false, recovery: 'Install the OWS CLI, then retry.' },
      ) };
    }
    try {
      const signer = await createOwsSigner(owsWallet);
      return { ok: true, signer, walletAddress: signer.address, owsWallet };
    } catch (err: any) {
      return { ok: false, error: mcpError(
        `Failed to load OWS wallet "${owsWallet}": ${err.message}`,
        { type: 'AUTH', code: 'OWS_WALLET_ERROR', retryable: false, recovery: 'Run `ows wallet list` to see available wallets.' },
      ) };
    }
  }

  try {
    const signerData = await loadSignerOrFail();
    const signer = await createKeyPairSignerFromBytes(signerData.secretKey);
    return { ok: true, signer, walletAddress: signerData.walletAddress };
  } catch {
    return { ok: false, error: mcpError(
      'No keypair found. Call `generateKeypair` first to create a wallet.',
      { type: 'AUTH', code: 'NO_KEYPAIR', retryable: false, recovery: 'Call `generateKeypair` to create a wallet.' },
    ) };
  }
}

export async function createOwsSigner(walletName: string): Promise<OwsSigner> {
  const solAddress = await getOwsSolanaAddress(walletName);
  const addr = address(solAddress);

  return {
    address: addr,

    async signTransactions(
      transactions: readonly { messageBytes: Uint8Array }[],
    ): Promise<readonly Record<string, Uint8Array>[]> {
      return Promise.all(
        transactions.map(async (tx) => {
          const msgHex = Buffer.from(tx.messageBytes).toString('hex');
          const sig = await owsSignBytes(walletName, msgHex);
          return { [addr]: sig };
        }),
      );
    },

    async signMessages(
      messages: readonly { content: Uint8Array }[],
    ): Promise<readonly Record<string, Uint8Array>[]> {
      return Promise.all(
        messages.map(async (msg) => {
          const hex = Buffer.from(msg.content).toString('hex');
          const sig = await owsSignBytes(walletName, hex);
          return { [addr]: sig };
        }),
      );
    },
  };
}
