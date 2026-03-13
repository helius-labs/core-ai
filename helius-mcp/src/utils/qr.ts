import QRCode from "qrcode";

export async function generateWalletQR(address: string): Promise<string> {
  const solanaUri = `solana:${address}`;
  return QRCode.toString(solanaUri, { type: "utf8" });
}
