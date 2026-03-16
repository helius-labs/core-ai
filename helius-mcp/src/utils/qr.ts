import QRCode from "qrcode";

const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

/**
 * Build a Solana Pay URI.
 * - No amount: generic address QR
 * - With usdcAmount: exact USDC transfer QR via spl-token param
 */
export function buildSolanaPayUri(address: string, usdcAmount?: number): string {
  if (usdcAmount != null && usdcAmount > 0) {
    return `solana:${address}?amount=${usdcAmount}&spl-token=${USDC_MINT}`;
  }
  return `solana:${address}`;
}

/**
 * Generate a UTF-8 QR code string.
 * Accepts either:
 * - A raw Solana Pay URL from the backend/SDK (preferred — includes memo for payment tracking)
 * - An address + optional usdcAmount (fallback — builds a local Solana Pay URI)
 */
export async function generateSolanaPayQR(solanaPayUrl: string): Promise<string> {
  return QRCode.toString(solanaPayUrl, { type: "utf8" });
}

/** @deprecated Use generateSolanaPayQR with a URL from the SDK instead */
export async function generateWalletQR(address: string, usdcAmount?: number): Promise<string> {
  const uri = buildSolanaPayUri(address, usdcAmount);
  return generateSolanaPayQR(uri);
}
