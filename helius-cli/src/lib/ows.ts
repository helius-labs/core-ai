/**
 * Open Wallet Standard (OWS) integration for helius-cli.
 *
 * Provides helpers to detect the `ows` CLI, list wallets, and extract
 * Solana addresses.  Used by `helius wallet ows-link` and OWS-aware
 * command flags.
 *
 * NOTE: The CLI helpers (isOwsInstalled, getOwsSolanaAddress) are mirrored in
 * helius-mcp/src/utils/ows.ts.  Keep the two copies in sync when changing
 * argument handling, CAIP-2 lookup logic, or OWS CLI flags.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { getNetwork } from "./config.js";

const execFileAsync = promisify(execFile);

// CAIP-2 chain identifiers for Solana networks.
// See OWS spec 07-supported-chains.md.
const SOLANA_CAIP2_MAINNET = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";
const SOLANA_CAIP2_DEVNET = "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";

/** Alphanumeric, hyphens, and underscores — matches OWS wallet naming rules. */
const WALLET_NAME_RE = /^[a-zA-Z0-9_-]{1,64}$/;

/** True when the `ows` binary is reachable on PATH. */
export async function isOwsInstalled(): Promise<boolean> {
  try {
    await execFileAsync("ows", ["--version"], { timeout: 5_000 });
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
export function validateWalletName(name: string): void {
  if (!WALLET_NAME_RE.test(name)) {
    throw new Error(
      `Invalid OWS wallet name "${name}". ` +
        `Names must be 1-64 characters using letters, digits, hyphens, or underscores.`,
    );
  }
}

/** Return parsed JSON from `ows wallet list --json`. */
export async function listOwsWallets(): Promise<
  Array<{ id: string; name: string; accounts?: Record<string, unknown> }>
> {
  const { stdout } = await execFileAsync("ows", ["wallet", "list", "--json"], {
    timeout: 10_000,
  });
  const parsed = JSON.parse(stdout);
  // The CLI may return { wallets: [...] } or a bare array.
  return Array.isArray(parsed) ? parsed : parsed.wallets ?? [];
}

/**
 * Return the Solana address for the named OWS wallet.
 * Uses the current CLI network setting (mainnet or devnet) to select
 * the correct CAIP-2 chain key.
 */
export async function getOwsSolanaAddress(
  walletName: string,
): Promise<string> {
  validateWalletName(walletName);

  const { stdout } = await execFileAsync(
    "ows",
    ["wallet", "info", "--wallet", walletName, "--json"],
    { timeout: 10_000 },
  );
  const info = JSON.parse(stdout);

  // The CLI outputs accounts keyed by CAIP-2 chain id.
  // Pick the key matching the active network.
  const network = getNetwork();
  const primaryKey =
    network === "devnet" ? SOLANA_CAIP2_DEVNET : SOLANA_CAIP2_MAINNET;
  const account =
    info.accounts?.[primaryKey] ??
    info.accounts?.solana ??
    Object.entries(info.accounts ?? {}).find(([k]) =>
      k.includes("solana"),
    )?.[1];

  if (!account) {
    throw new Error(
      `OWS wallet "${walletName}" has no Solana account. ` +
        `Run \`ows wallet info --wallet ${walletName}\` to inspect.`,
    );
  }

  const addr: string =
    typeof account === "string" ? account : (account as any).address;
  if (!addr) {
    throw new Error(
      `Could not extract Solana address from OWS wallet "${walletName}".`,
    );
  }
  return addr;
}
