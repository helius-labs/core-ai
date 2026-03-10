# Jupiter Ultra Swap API

## What This Covers

Token swaps via Jupiter's Ultra API — getting quotes, executing swaps, handling idempotency, and production hardening. Ultra provides optimized routing across all Solana DEXes.

---

## Base URL & Auth

```
Base: https://api.jup.ag/ultra/v1
Auth: x-api-key header (required)
```

Rate limits are dynamic — see `references/jupiter-portal.md` for details.

---

## Endpoints

### GET /order — Get Quote

Returns a swap quote with routing information.

```typescript
const params = new URLSearchParams({
  inputMint: 'So11111111111111111111111111111111111111112', // SOL
  outputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
  amount: '1000000000', // 1 SOL in lamports
  taker: walletPublicKey,
});

const response = await fetch(`https://api.jup.ag/ultra/v1/order?${params}`, {
  headers: { 'x-api-key': process.env.JUPITER_API_KEY! },
});

const quote = await response.json();
// Returns: { transaction, requestId, inputMint, outputMint, inAmount, outAmount, ... }
```

**Key parameters**:
- `inputMint` — Source token mint address
- `outputMint` — Destination token mint address
- `amount` — Amount in atomic units (lamports for SOL, raw units for SPL tokens)
- `taker` — Wallet public key that will sign the transaction
- `slippageBps` — Slippage tolerance in basis points (optional, default is auto)

### POST /execute — Execute Swap

Submit the signed transaction for execution.

```typescript
const executeResponse = await fetch('https://api.jup.ag/ultra/v1/execute', {
  method: 'POST',
  headers: {
    'x-api-key': process.env.JUPITER_API_KEY!,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    signedTransaction: base64SignedTx,
    requestId: quote.requestId, // From the /order response
  }),
});

const result = await executeResponse.json();
// Returns: { status, signature, ... }
```

**CRITICAL**: Always include `requestId` from the `/order` response. This enables idempotent retries within a 2-minute window — if the request fails mid-flight, you can safely retry with the same `requestId`.

### GET /execute-status — Check Status

Poll for execution status after submitting.

```typescript
const statusResponse = await fetch(
  `https://api.jup.ag/ultra/v1/execute-status?requestId=${requestId}`,
  { headers: { 'x-api-key': process.env.JUPITER_API_KEY! } }
);

const status = await statusResponse.json();
// status.status: "Success" | "Failed" | "Pending"
```

---

## Complete Swap Flow

### Using Jupiter Ultra (Recommended)

Jupiter Ultra handles routing, transaction building, and execution:

```typescript
import { Keypair, VersionedTransaction } from '@solana/web3.js';

async function swapWithUltra(
  keypair: Keypair,
  inputMint: string,
  outputMint: string,
  amount: string,
): Promise<string> {
  const API_KEY = process.env.JUPITER_API_KEY!;
  const headers = { 'x-api-key': API_KEY };

  // 1. Get quote and transaction
  const params = new URLSearchParams({
    inputMint,
    outputMint,
    amount,
    taker: keypair.publicKey.toBase58(),
  });

  const orderRes = await fetch(
    `https://api.jup.ag/ultra/v1/order?${params}`,
    { headers }
  );
  const order = await orderRes.json();

  if (order.error) throw new Error(`Jupiter order error: ${order.error}`);

  // 2. Deserialize and sign
  const txBuffer = Buffer.from(order.transaction, 'base64');
  const transaction = VersionedTransaction.deserialize(txBuffer);
  transaction.sign([keypair]);

  // 3. Execute via Jupiter
  const signedTx = Buffer.from(transaction.serialize()).toString('base64');
  const execRes = await fetch('https://api.jup.ag/ultra/v1/execute', {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      signedTransaction: signedTx,
      requestId: order.requestId,
    }),
  });

  const result = await execRes.json();
  if (result.status === 'Failed') {
    throw new Error(`Swap failed: ${result.error || 'unknown error'}`);
  }

  return result.signature;
}
```

### Using Jupiter Quote + Helius Sender (Alternative)

For more control over transaction submission, you can use Jupiter for the quote/transaction and Helius Sender for submission. See `references/integration-patterns.md` Pattern 1.

---

## Fees

Jupiter Ultra charges 5-10 basis points (0.05-0.10%) on swaps. This is included in the quoted output amount — no separate fee calculation needed.

---

## Gasless Swaps

Ultra supports gasless swaps for wallets with less than 0.01 SOL. Jupiter covers the transaction fee in these cases.

This is automatic — no extra parameters needed. When the taker's SOL balance is below the threshold, Jupiter handles gas fees within the swap transaction.

### Helius Synergy

Combine gasless swaps with Helius Wallet API to detect low-SOL wallets and proactively offer gasless mode:

```typescript
// Check if wallet qualifies for gasless
// Use getBalance MCP tool
// If balance < 0.01 SOL, inform user that gasless swap is available
```

---

## Metis Swap API (Advanced Alternative)

For advanced use cases requiring low-level routing control, Jupiter also offers the Metis API:

```
GET  https://api.jup.ag/swap/v1/quote    — Get routing quote
POST https://api.jup.ag/swap/v1/swap     — Build transaction
```

**When to use Metis over Ultra**:
- You need custom compute unit budgets
- You need to inspect and modify the transaction before signing
- You want direct control over slippage parameters
- You're integrating into an existing transaction pipeline

**When to use Ultra** (recommended for most cases):
- Simpler API (fewer parameters)
- Built-in gasless support
- `requestId` idempotency
- Jupiter handles execution and retries

Most integrations should use Ultra. Only use Metis if you have a specific need for low-level control.

---

## Slippage

- Default: auto-calculated by Jupiter
- Custom: pass `slippageBps` parameter (e.g., `50` = 0.5%)
- Recommended: use auto unless the user has a specific requirement

---

## Common Mints

| Token | Mint Address |
|---|---|
| SOL | `So11111111111111111111111111111111111111112` |
| USDC | `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v` |
| USDT | `Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB` |

For other tokens, use the Jupiter Tokens API (`references/jupiter-tokens-price.md`) to look up mint addresses.

---

## Error Handling

### Negative Error Codes (Jupiter-Specific)

Negative error codes from `/execute` indicate Jupiter-internal errors (routing, slippage, etc.). These are typically transient — retry with a fresh quote.

### Positive Error Codes (On-Chain Program Errors)

Positive error codes indicate on-chain program failures. Inspect the error message for details (insufficient balance, slippage exceeded, etc.).

### Timeout Handling

- Set 5-second timeout for `/order` (quote) requests
- Set 30-second timeout for `/execute` requests
- If `/execute` times out, use `/execute-status` with the `requestId` to check — do NOT re-execute without checking status first

---

## Production Checklist

1. Always include `x-api-key` header
2. Always use `requestId` for idempotent retries
3. Set appropriate timeouts (5s quotes, 30s executions)
4. Implement exponential backoff for 429 responses
5. Validate mint addresses before calling the API
6. Enforce slippage guardrails for user protection
7. Check `/execute-status` before retrying failed executions
8. Log all API interactions with latency metrics

---

## Resources

- Ultra Swap Docs: [dev.jup.ag/docs/ultra](https://dev.jup.ag/docs/ultra)
- Jupiter Portal (API keys): [portal.jup.ag](https://portal.jup.ag/)
