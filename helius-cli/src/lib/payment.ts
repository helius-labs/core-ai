import {
  createSolanaRpc,
  createSolanaRpcSubscriptions,
  sendAndConfirmTransactionFactory,
  createKeyPairSignerFromBytes,
  address,
  pipe,
  createTransactionMessage,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  appendTransactionMessageInstructions,
  signTransactionMessageWithSigners,
  getSignatureFromTransaction,
  type Blockhash,
} from "@solana/kit";
import {
  getTransferInstruction,
  findAssociatedTokenPda,
  TOKEN_PROGRAM_ADDRESS,
} from "@solana-program/token";
import { TREASURY, USDC_MINT, PAYMENT_AMOUNT } from "../constants.js";
import type { WalletKeypair } from "./wallet.js";

const RPC_URL = "https://api.mainnet-beta.solana.com";
const WS_URL = "wss://api.mainnet-beta.solana.com";

export async function payUSDC(keypair: WalletKeypair): Promise<string> {
  const rpc = createSolanaRpc(RPC_URL);
  const rpcSubscriptions = createSolanaRpcSubscriptions(WS_URL);
  const sendAndConfirm = sendAndConfirmTransactionFactory({
    rpc,
    rpcSubscriptions,
  });

  const signer = await createKeyPairSignerFromBytes(keypair.secretKey);
  const signerAddress = signer.address;

  // Find ATAs for sender and receiver
  const [senderAta] = await findAssociatedTokenPda({
    owner: signerAddress,
    mint: USDC_MINT,
    tokenProgram: TOKEN_PROGRAM_ADDRESS,
  });

  const [receiverAta] = await findAssociatedTokenPda({
    owner: address(TREASURY),
    mint: USDC_MINT,
    tokenProgram: TOKEN_PROGRAM_ADDRESS,
  });

  // Get recent blockhash
  const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();

  // Build transfer instruction
  const transferIx = getTransferInstruction({
    source: senderAta,
    destination: receiverAta,
    authority: signer,
    amount: PAYMENT_AMOUNT,
  });

  // Build transaction message
  const transactionMessage = pipe(
    createTransactionMessage({ version: 0 }),
    (tx) => setTransactionMessageFeePayerSigner(signer, tx),
    (tx) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, tx),
    (tx) => appendTransactionMessageInstructions([transferIx], tx)
  );

  // Sign transaction
  const signedTransaction = await signTransactionMessageWithSigners(transactionMessage);

  // Construct the object expected by sendAndConfirm with lastValidBlockHeight
  const transactionWithBlockHeight = {
    ...signedTransaction,
    lifetimeConstraint: {
      lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
    },
  };

  // Send and confirm
  await sendAndConfirm(transactionWithBlockHeight as Parameters<typeof sendAndConfirm>[0], {
    commitment: "confirmed",
  });

  return getSignatureFromTransaction(signedTransaction);
}

export async function checkUsdcBalance(
  keypair: WalletKeypair
): Promise<bigint> {
  const rpc = createSolanaRpc(RPC_URL);
  const signer = await createKeyPairSignerFromBytes(keypair.secretKey);
  const signerAddress = signer.address;

  const [ata] = await findAssociatedTokenPda({
    owner: signerAddress,
    mint: USDC_MINT,
    tokenProgram: TOKEN_PROGRAM_ADDRESS,
  });

  try {
    const response = await rpc.getTokenAccountBalance(ata).send();
    return BigInt(response.value.amount);
  } catch {
    return 0n;
  }
}

export async function checkSolBalance(
  keypair: WalletKeypair
): Promise<bigint> {
  const rpc = createSolanaRpc(RPC_URL);
  const signer = await createKeyPairSignerFromBytes(keypair.secretKey);

  try {
    const response = await rpc.getBalance(signer.address).send();
    return response.value;
  } catch {
    return 0n;
  }
}

// Minimum SOL needed for transaction fees
// Note: If receiver ATA doesn't exist, ~0.002 SOL extra needed for rent
export const MIN_SOL_FOR_TX = 1_000_000n; // 0.001 SOL
