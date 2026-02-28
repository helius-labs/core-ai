# Phantom Transaction Signing

## Overview

Phantom signs transactions but does NOT submit them. The flow is always:

1. **Build** the transaction (your code)
2. **Sign** via Phantom (`signTransaction` / `signAllTransactions`)
3. **Submit** via Helius Sender (see `references/helius-sender.md`)
4. **Confirm** by polling signature status

This separation is critical — the wallet only signs, Helius Sender handles submission with optimal routing.

## signTransaction

Signs a single transaction. Works with both `VersionedTransaction` (recommended) and legacy `Transaction`.

### Direct Provider

```typescript
import {
  Connection,
  TransactionMessage,
  VersionedTransaction,
  SystemProgram,
  PublicKey,
  LAMPORTS_PER_SOL,
  ComputeBudgetProgram,
} from '@solana/web3.js';

async function signAndSubmit(
  provider: PhantomSolanaProvider,
  connection: Connection
) {
  const fromPubkey = provider.publicKey!;

  // 1. Get blockhash
  const { blockhash, lastValidBlockHeight } =
    (await connection.getLatestBlockhash('confirmed'));

  // 2. Build instructions
  const instructions = [
    ComputeBudgetProgram.setComputeUnitLimit({ units: 50_000 }),
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 200_000 }),
    SystemProgram.transfer({
      fromPubkey,
      toPubkey: new PublicKey('RECIPIENT_ADDRESS'),
      lamports: 0.01 * LAMPORTS_PER_SOL,
    }),
    // Jito tip (required for Sender)
    SystemProgram.transfer({
      fromPubkey,
      toPubkey: new PublicKey('4ACfpUFoaSD9bfPdeu6DBt89gB6ENTeHBXCAi87NhDEE'),
      lamports: 200_000, // 0.0002 SOL minimum
    }),
  ];

  // 3. Build VersionedTransaction
  const messageV0 = new TransactionMessage({
    payerKey: fromPubkey,
    recentBlockhash: blockhash,
    instructions,
  }).compileToV0Message();

  const transaction = new VersionedTransaction(messageV0);

  // 4. Phantom signs (user sees approval popup)
  const signedTransaction = await provider.signTransaction(transaction);

  // 5. Submit to Helius Sender
  const serialized = signedTransaction.serialize();
  const base64Tx = btoa(String.fromCharCode(...serialized));

  const response = await fetch('https://sender.helius-rpc.com/fast', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: '1',
      method: 'sendTransaction',
      params: [base64Tx, { encoding: 'base64', skipPreflight: true, maxRetries: 0 }],
    }),
  });

  const result = await response.json();
  if (result.error) throw new Error(result.error.message);

  // 6. Poll for confirmation
  const signature = result.result;
  await pollConfirmation(signature, connection, lastValidBlockHeight);
  return signature;
}
```

### Wallet Adapter

```typescript
import { useWallet, useConnection } from '@solana/wallet-adapter-react';

function SendButton() {
  const { publicKey, signTransaction } = useWallet();
  const { connection } = useConnection();

  async function handleSend() {
    if (!publicKey || !signTransaction) return;

    const { blockhash, lastValidBlockHeight } =
      await connection.getLatestBlockhash('confirmed');

    const transaction = new VersionedTransaction(
      new TransactionMessage({
        payerKey: publicKey,
        recentBlockhash: blockhash,
        instructions: [/* your instructions */],
      }).compileToV0Message()
    );

    const signed = await signTransaction(transaction);
    // Submit to Helius Sender...
  }

  return <button onClick={handleSend}>Send</button>;
}
```

## signAllTransactions

Signs multiple transactions in a single approval popup. Use for batch operations:

```typescript
async function signBatch(
  provider: PhantomSolanaProvider,
  transactions: VersionedTransaction[]
): Promise<VersionedTransaction[]> {
  // User sees one popup listing all transactions
  const signedTransactions = await provider.signAllTransactions(transactions);
  return signedTransactions;
}
```

**When to use**: Multiple independent transactions that should be approved together (e.g., batch transfers, multiple NFT listings). Each transaction is still submitted separately to Sender.

## signMessage

Signs an arbitrary message (NOT a transaction). Used for authentication, proof of ownership, and off-chain verification.

```typescript
async function signAuthMessage(
  provider: PhantomSolanaProvider
): Promise<{ signature: Uint8Array; publicKey: string }> {
  const message = new TextEncoder().encode(
    `Sign in to MyApp\nTimestamp: ${Date.now()}`
  );

  const { signature } = await provider.signMessage(message);

  return {
    signature,
    publicKey: provider.publicKey!.toBase58(),
  };
}
```

### Backend Verification

Verify the signature on your server using `tweetnacl`:

```typescript
import nacl from 'tweetnacl';
import { PublicKey } from '@solana/web3.js';

function verifySignature(
  message: string,
  signatureBytes: Uint8Array,
  publicKeyBase58: string
): boolean {
  const messageBytes = new TextEncoder().encode(message);
  const publicKeyBytes = new PublicKey(publicKeyBase58).toBytes();

  return nacl.sign.detached.verify(messageBytes, signatureBytes, publicKeyBytes);
}
```

## Complete Build-Sign-Submit Flow

The full pattern for frontend Solana transactions:

```typescript
import {
  Connection,
  TransactionMessage,
  VersionedTransaction,
  SystemProgram,
  PublicKey,
  LAMPORTS_PER_SOL,
  ComputeBudgetProgram,
} from '@solana/web3.js';

const TIP_ACCOUNTS = [
  '4ACfpUFoaSD9bfPdeu6DBt89gB6ENTeHBXCAi87NhDEE',
  'D2L6yPZ2FmmmTKPgzaMKdhu6EWZcTpLy1Vhx8uvZe7NZ',
  '9bnz4RShgq1hAnLnZbP8kbgBg1kEmcJBYQq3gQbmnSta',
  '5VY91ws6B2hMmBFRsXkoAAdsPHBJwRfBht4DXox3xkwn',
  '2nyhqdwKcJZR2vcqCyrYsaPVdAnFoJjiksCXJ7hfEYgD',
];

async function buildSignSubmit(
  provider: PhantomSolanaProvider,
  instructions: TransactionInstruction[],
  connection: Connection
): Promise<string> {
  const fromPubkey = provider.publicKey!;

  // 1. Get blockhash
  const { blockhash, lastValidBlockHeight } =
    await connection.getLatestBlockhash('confirmed');

  // 2. Get priority fee from backend proxy
  const feeResponse = await fetch('/api/helius/priority-fee', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      accountKeys: instructions.flatMap((ix) =>
        ix.keys.map((k) => k.pubkey.toBase58())
      ),
    }),
  });
  const { priorityFee } = await feeResponse.json();

  // 3. Pick random tip account
  const tipAccount = TIP_ACCOUNTS[Math.floor(Math.random() * TIP_ACCOUNTS.length)];

  // 4. Build transaction with proper instruction ordering
  const allInstructions = [
    ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }), // refine via simulation
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: priorityFee }),
    ...instructions,
    SystemProgram.transfer({
      fromPubkey,
      toPubkey: new PublicKey(tipAccount),
      lamports: 200_000, // 0.0002 SOL minimum Jito tip
    }),
  ];

  const transaction = new VersionedTransaction(
    new TransactionMessage({
      payerKey: fromPubkey,
      recentBlockhash: blockhash,
      instructions: allInstructions,
    }).compileToV0Message()
  );

  // 5. Phantom signs (user approval popup)
  const signedTx = await provider.signTransaction(transaction);

  // 6. Submit to Helius Sender (browser-safe HTTPS endpoint, no API key needed)
  const serialized = signedTx.serialize();
  const base64Tx = btoa(String.fromCharCode(...serialized));

  const response = await fetch('https://sender.helius-rpc.com/fast', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: Date.now().toString(),
      method: 'sendTransaction',
      params: [base64Tx, { encoding: 'base64', skipPreflight: true, maxRetries: 0 }],
    }),
  });

  const result = await response.json();
  if (result.error) throw new Error(result.error.message);

  const signature = result.result;

  // 7. Poll for confirmation
  await pollConfirmation(signature, connection, lastValidBlockHeight);
  return signature;
}

async function pollConfirmation(
  signature: string,
  connection: Connection,
  lastValidBlockHeight: number
): Promise<void> {
  for (let i = 0; i < 30; i++) {
    const currentHeight = await connection.getBlockHeight('confirmed');
    if (currentHeight > lastValidBlockHeight) {
      throw new Error('Blockhash expired — transaction may have failed');
    }

    const status = await connection.getSignatureStatuses([signature]);
    const value = status?.value?.[0];
    if (value?.confirmationStatus === 'confirmed' || value?.confirmationStatus === 'finalized') {
      if (value.err) throw new Error(`Transaction failed: ${JSON.stringify(value.err)}`);
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Confirmation timeout for ${signature}`);
}
```

## Handling Serialized Transactions from APIs

When you receive a serialized transaction from a swap API (e.g., Jupiter, DFlow), deserialize it, have Phantom sign it, then submit via Sender:

```typescript
async function signExternalTransaction(
  provider: PhantomSolanaProvider,
  serializedBase64: string
): Promise<string> {
  // Deserialize the transaction from the API
  const transactionBytes = Uint8Array.from(atob(serializedBase64), (c) => c.charCodeAt(0));
  const transaction = VersionedTransaction.deserialize(transactionBytes);

  // Phantom signs it
  const signedTx = await provider.signTransaction(transaction);

  // Submit to Sender
  const serialized = signedTx.serialize();
  const base64Tx = btoa(String.fromCharCode(...serialized));

  const response = await fetch('https://sender.helius-rpc.com/fast', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: '1',
      method: 'sendTransaction',
      params: [base64Tx, { encoding: 'base64', skipPreflight: true, maxRetries: 0 }],
    }),
  });

  const result = await response.json();
  if (result.error) throw new Error(result.error.message);
  return result.result;
}
```

## Error Handling

| Error | Code | Cause | Fix |
|---|---|---|---|
| User rejected the request | `4001` | User clicked "Cancel" in Phantom | Show user-friendly message, allow retry |
| Unauthorized | `4100` | App not connected | Call `connect()` first |
| Unsupported method | `4200` | Method not supported | Check Phantom version |
| Disconnected | `4900` | Wallet disconnected | Reconnect, rebuild, re-sign |
| Blockhash expired | N/A | Transaction took too long | Fetch new blockhash, rebuild, re-sign |
| Transaction too large | N/A | Transaction exceeds 1232 bytes | Reduce instruction count, use lookup tables |

### Error Handling Pattern

```typescript
try {
  const signed = await provider.signTransaction(transaction);
  // submit...
} catch (error: any) {
  switch (error.code) {
    case 4001:
      showToast('Transaction cancelled');
      break;
    case 4100:
      // Reconnect and retry
      await provider.connect();
      break;
    case 4900:
      setConnected(false);
      showToast('Wallet disconnected. Please reconnect.');
      break;
    default:
      if (error.message?.includes('blockhash')) {
        // Rebuild transaction with fresh blockhash and re-sign
        showToast('Transaction expired. Please try again.');
      } else {
        showToast(`Error: ${error.message}`);
      }
  }
}
```

## Common Mistakes

- **Using legacy `Transaction` instead of `VersionedTransaction`** — `VersionedTransaction` supports address lookup tables and is the current standard. Phantom supports both, but always prefer `VersionedTransaction`.
- **Calling `sendTransaction` through Wallet Adapter instead of Sender** — Wallet Adapter's `sendTransaction` sends through the RPC endpoint in `ConnectionProvider`, which is slower. Instead, use `signTransaction` + submit to Helius Sender separately.
- **Forgetting Jito tip when using Sender** — Sender rejects transactions without a tip instruction. See `references/helius-sender.md` for tip accounts and minimum amounts.
- **Not handling user rejection (code 4001)** — the user can always cancel. This is not an error to retry — show a user-friendly message.
- **Auto-approving transactions** — never try to bypass the Phantom approval popup. Each transaction must be explicitly approved by the user.
- **Not checking `provider.publicKey` before building transactions** — it's `null` when disconnected.
- **Using `Buffer` in browser code** — `Buffer` is a Node.js API. Use `Uint8Array` and `btoa`/`atob` for base64 encoding in the browser, or use a polyfill.
- **Submitting to Sender without `skipPreflight: true`** — mandatory for Sender. See `references/helius-sender.md`.
