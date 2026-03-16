import QRCode from "qrcode";

const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

/**
 * Build a Solana Pay URI.
 * - No amount: generic address QR (wallet funding, any token)
 * - With usdcAmount: exact USDC transfer QR via spl-token param
 */
export function buildSolanaPayUri(address: string, usdcAmount?: number): string {
  if (usdcAmount != null && usdcAmount > 0) {
    return `solana:${address}?amount=${usdcAmount}&spl-token=${USDC_MINT}`;
  }
  return `solana:${address}`;
}

/**
 * Print a QR code to the terminal.
 * Accepts either:
 * - A raw Solana Pay URL from the backend/SDK (preferred — includes memo for payment tracking)
 * - An address + optional usdcAmount (fallback — builds a local Solana Pay URI)
 */
export async function printSolanaPayQR(solanaPayUrl: string): Promise<void> {
  const qr = await QRCode.toString(solanaPayUrl, { type: "terminal", small: true });
  console.log("");
  console.log(qr);
}

/** @deprecated Use printSolanaPayQR with a URL from the SDK instead */
export async function printWalletQR(address: string, usdcAmount?: number): Promise<void> {
  const uri = buildSolanaPayUri(address, usdcAmount);
  return printSolanaPayQR(uri);
}
