import QRCode from "qrcode";

export async function printWalletQR(address: string): Promise<void> {
  const solanaUri = `solana:${address}`;
  const qr = await QRCode.toString(solanaUri, { type: "terminal", small: true });
  console.log("");
  console.log(qr);
}
