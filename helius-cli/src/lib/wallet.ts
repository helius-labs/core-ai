import fs from "fs";
import nacl from "tweetnacl";
import bs58 from "bs58";
import { createKeyPairSignerFromBytes } from "@solana/kit";

export interface WalletKeypair {
  publicKey: Uint8Array;
  secretKey: Uint8Array;
}

export async function loadKeypair(keypairPath: string): Promise<WalletKeypair> {
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

  const secretKey = Uint8Array.from(secretKeyArray);
  const publicKey = secretKey.slice(32);

  return { publicKey, secretKey };
}

export async function getAddress(keypair: WalletKeypair): Promise<string> {
  const signer = await createKeyPairSignerFromBytes(keypair.secretKey);
  return signer.address;
}

export function signAuthMessage(secretKey: Uint8Array): {
  message: string;
  signature: string;
} {
  // Create JSON message with current timestamp (Unix time in milliseconds)
  const message = JSON.stringify({
    message: "Please sign this message to verify ownership of your wallet and connect to Helius.",
    timestamp: Date.now()
  });

  const messageBytes = new TextEncoder().encode(message);
  const signatureBytes = nacl.sign.detached(messageBytes, secretKey);
  const signature = bs58.encode(signatureBytes);

  return { message, signature };
}
