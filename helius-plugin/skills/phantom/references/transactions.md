# Transaction Patterns Reference

Detailed transaction patterns for Solana with Phantom Connect SDKs and Helius infrastructure.

## The Sign → Sender Flow

**Always** use this pattern: Phantom signs the transaction, then you submit to Helius Sender for optimal landing rates. Never use `signAndSendTransaction` — it submits through standard RPC, which is slower.

```
1. Build VersionedTransaction with priority fees + Jito tip
2. Phantom signs (signTransaction)
3. Submit to Helius Sender (https://sender.helius-rpc.com/fast)
4. Poll for confirmation
```

## Dependencies

```bash
npm install @solana/web3.js
```

## SOL Transfer

```ts
import {
  Connection,
  PublicKey,
  SystemProgram,
  VersionedTransaction,
  TransactionMessage,
  ComputeBudgetProgram,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";

const TIP_ACCOUNTS = [
  "4ACfpUFoaSD9bfPdeu6DBt89gB6ENTeHBXCAi87NhDEE",
  "D2L6yPZ2FmmmTKPgzaMKdhu6EWZcTpLy1Vhx8uvZe7NZ",
  "9bnz4RShgq1hAnLnZbP8kbgBg1kEmcJBYQq3gQbmnSta",
];

async function transferSol(solana: any, recipient: string, amountSOL: number) {
  // 1. Get blockhash via backend proxy (API key stays server-side)
  // See references/frontend-security.md for proxy setup
  const bhRes = await fetch("/api/rpc", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0", id: "1",
      method: "getLatestBlockhash",
      params: [{ commitment: "confirmed" }],
    }),
  });
  const { result: bhResult } = await bhRes.json();
  const blockhash = bhResult.value.blockhash;

  // 2. Get priority fee via backend proxy
  const fromAddress = await solana.getPublicKey();
  const feeRes = await fetch("/api/rpc", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0", id: "1",
      method: "getPriorityFeeEstimate",
      params: [{ accountKeys: [fromAddress], options: { priorityLevel: "High" } }],
    }),
  });
  const { result: feeResult } = await feeRes.json();
  const priorityFee = Math.ceil((feeResult?.priorityFeeEstimate || 200_000) * 1.2);

  // 3. Build transaction with proper instruction ordering
  const tipAccount = TIP_ACCOUNTS[Math.floor(Math.random() * TIP_ACCOUNTS.length)];

  const instructions = [
    // CU limit FIRST
    ComputeBudgetProgram.setComputeUnitLimit({ units: 50_000 }),
    // CU price SECOND
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: priorityFee }),
    // Your instructions in the MIDDLE
    SystemProgram.transfer({
      fromPubkey: new PublicKey(fromAddress),
      toPubkey: new PublicKey(recipient),
      lamports: Math.floor(amountSOL * LAMPORTS_PER_SOL),
    }),
    // Jito tip LAST
    SystemProgram.transfer({
      fromPubkey: new PublicKey(fromAddress),
      toPubkey: new PublicKey(tipAccount),
      lamports: 200_000, // 0.0002 SOL minimum Jito tip
    }),
  ];

  const message = new TransactionMessage({
    payerKey: new PublicKey(fromAddress),
    recentBlockhash: blockhash,
    instructions,
  }).compileToV0Message();

  const transaction = new VersionedTransaction(message);

  // 4. Phantom signs (does NOT send)
  const signedTx = await solana.signTransaction(transaction);

  // 5. Submit to Helius Sender — see references/helius-sender.md
  const serialized = signedTx.serialize();
  const base64Tx = btoa(String.fromCharCode(...serialized));

  const response = await fetch("https://sender.helius-rpc.com/fast", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "1",
      method: "sendTransaction",
      params: [base64Tx, { encoding: "base64", skipPreflight: true, maxRetries: 0 }],
    }),
  });

  const result = await response.json();
  if (result.error) throw new Error(result.error.message);

  // 6. Poll for confirmation
  const signature = result.result;
  await pollConfirmation(signature);

  return signature;
}
```

## SPL Token Transfer

```ts
import {
  PublicKey,
  VersionedTransaction,
  TransactionMessage,
  ComputeBudgetProgram,
  SystemProgram,
} from "@solana/web3.js";
import {
  getAssociatedTokenAddress,
  createTransferInstruction,
} from "@solana/spl-token";

async function transferToken(
  solana: any,
  mint: string,
  recipient: string,
  amount: number,
  decimals: number
) {
  const fromAddress = await solana.getPublicKey();
  const fromPubkey = new PublicKey(fromAddress);
  const mintPubkey = new PublicKey(mint);
  const toPubkey = new PublicKey(recipient);

  const fromAta = await getAssociatedTokenAddress(mintPubkey, fromPubkey);
  const toAta = await getAssociatedTokenAddress(mintPubkey, toPubkey);

  const transferAmount = amount * Math.pow(10, decimals);

  // Get blockhash + priority fee via proxy (same as SOL transfer above)
  const bhRes = await fetch("/api/rpc", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0", id: "1",
      method: "getLatestBlockhash",
      params: [{ commitment: "confirmed" }],
    }),
  });
  const { result: bhResult } = await bhRes.json();

  const feeRes = await fetch("/api/rpc", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0", id: "1",
      method: "getPriorityFeeEstimate",
      params: [{ accountKeys: [fromAddress, mint], options: { priorityLevel: "High" } }],
    }),
  });
  const { result: feeResult } = await feeRes.json();
  const priorityFee = Math.ceil((feeResult?.priorityFeeEstimate || 200_000) * 1.2);

  const TIP_ACCOUNTS = [
    "4ACfpUFoaSD9bfPdeu6DBt89gB6ENTeHBXCAi87NhDEE",
    "D2L6yPZ2FmmmTKPgzaMKdhu6EWZcTpLy1Vhx8uvZe7NZ",
  ];
  const tipAccount = TIP_ACCOUNTS[Math.floor(Math.random() * TIP_ACCOUNTS.length)];

  const instructions = [
    ComputeBudgetProgram.setComputeUnitLimit({ units: 100_000 }),
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: priorityFee }),
    createTransferInstruction(fromAta, toAta, fromPubkey, transferAmount),
    SystemProgram.transfer({
      fromPubkey,
      toPubkey: new PublicKey(tipAccount),
      lamports: 200_000,
    }),
  ];

  const message = new TransactionMessage({
    payerKey: fromPubkey,
    recentBlockhash: bhResult.value.blockhash,
    instructions,
  }).compileToV0Message();

  const transaction = new VersionedTransaction(message);

  // Sign with Phantom, submit to Sender
  const signedTx = await solana.signTransaction(transaction);
  const base64Tx = btoa(String.fromCharCode(...signedTx.serialize()));

  const response = await fetch("https://sender.helius-rpc.com/fast", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0", id: "1",
      method: "sendTransaction",
      params: [base64Tx, { encoding: "base64", skipPreflight: true, maxRetries: 0 }],
    }),
  });

  const result = await response.json();
  if (result.error) throw new Error(result.error.message);
  return result.result;
}
```

## Signing a Pre-Built Transaction (from Swap APIs)

When an API (Jupiter, DFlow, etc.) returns a serialized transaction, you only need to sign and submit:

```ts
async function signAndSubmitApiTransaction(solana: any, serializedTx: string) {
  // Deserialize the base64 transaction from the API
  const txBytes = Uint8Array.from(atob(serializedTx), (c) => c.charCodeAt(0));
  const transaction = VersionedTransaction.deserialize(txBytes);

  // Sign with Phantom
  const signedTx = await solana.signTransaction(transaction);

  // Submit to Helius Sender
  const base64Tx = btoa(String.fromCharCode(...signedTx.serialize()));

  const response = await fetch("https://sender.helius-rpc.com/fast", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "1",
      method: "sendTransaction",
      params: [base64Tx, { encoding: "base64", skipPreflight: true, maxRetries: 0 }],
    }),
  });

  const result = await response.json();
  if (result.error) throw new Error(result.error.message);
  return result.result;
}
```

## Message Signing

Use for authentication, proof of ownership, or off-chain verification:

```ts
// Sign a message
const message = "Hello World";
const { signature } = await solana.signMessage(message);
console.log("Signature:", signature);
```

## Confirmation Polling

Always poll for confirmation after submitting via Sender:

```ts
async function pollConfirmation(signature: string): Promise<void> {
  for (let i = 0; i < 30; i++) {
    // Poll via backend proxy (API key stays server-side)
    const response = await fetch("/api/rpc", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "1",
        method: "getSignatureStatuses",
        params: [[signature]],
      }),
    });
    const { result } = await response.json();
    const status = result?.value?.[0];
    if (status?.confirmationStatus === "confirmed" || status?.confirmationStatus === "finalized") {
      if (status.err) throw new Error("Transaction failed on-chain");
      return;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("Confirmation timeout — check explorer");
}
```

## Instruction Ordering (Required for Sender)

When building transactions for Helius Sender with Jito tips, instructions **must** be in this order:

1. `ComputeBudgetProgram.setComputeUnitLimit(...)` — first
2. `ComputeBudgetProgram.setComputeUnitPrice(...)` — second
3. Your instructions — middle
4. Jito tip transfer — last

See `references/helius-sender.md` and `references/helius-priority-fees.md` for details.

## Error Handling

```ts
try {
  const signedTx = await solana.signTransaction(transaction);
  // ... submit to Sender
} catch (error: any) {
  if (error.message?.includes("User rejected")) {
    console.log("User cancelled the transaction");
    // Not an error — don't retry
  } else if (error.message?.includes("insufficient funds")) {
    console.log("Not enough balance");
  } else {
    console.error("Transaction failed:", error);
  }
}
```

## Common Mistakes

- **Using `signAndSendTransaction` instead of `signTransaction` + Sender** — `signAndSendTransaction` submits through standard RPC. Always use `signTransaction`, then POST to Helius Sender for better landing rates.
- **Missing priority fees** — transactions without priority fees are deprioritized. Use `getPriorityFeeEstimate` via your backend proxy.
- **Missing Jito tip** — Helius Sender uses Jito for dual routing. Include a minimum 0.0002 SOL tip to benefit from Jito block building.
- **Wrong instruction ordering** — CU limit must be first, CU price second, Jito tip last. Incorrect ordering causes Sender to reject the transaction.
- **Using legacy `Transaction` instead of `VersionedTransaction`** — always use `VersionedTransaction` for address lookup table support and forward compatibility.
- **Hardcoding priority fees** — network conditions change. Always query `getPriorityFeeEstimate` for current fee levels.
- **Using public RPC for blockhash** — use your backend proxy to get the blockhash via Helius RPC (faster, more reliable). See `references/frontend-security.md`.
- **Not polling for confirmation** — Sender returns a signature immediately, but the transaction may not be confirmed yet. Always poll `getSignatureStatuses`.
