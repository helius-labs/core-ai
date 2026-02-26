import fs from "fs";
import { loadKeypair } from "helius-sdk/auth/loadKeypair";

export type { WalletKeypair } from "helius-sdk/auth/types";
export { getAddress } from "helius-sdk/auth/getAddress";
export { signAuthMessage } from "helius-sdk/auth/signAuthMessage";

export async function loadKeypairFromFile(keypairPath: string) {
  const resolvedPath = keypairPath.replace(/^~/, process.env.HOME || "");

  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`Keypair file not found: ${resolvedPath}`);
  }

  const fileContent = fs.readFileSync(resolvedPath, "utf-8");
  const secretKeyArray = JSON.parse(fileContent);

  if (!Array.isArray(secretKeyArray) || secretKeyArray.length !== 64) {
    throw new Error(
      "Invalid keypair format. Expected JSON array of 64 bytes (Solana CLI format)."
    );
  }

  const bytes = Uint8Array.from(secretKeyArray);
  return loadKeypair(bytes);
}
