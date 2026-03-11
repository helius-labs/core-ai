# Jupiter Trigger API — Limit Orders

## What This Covers

Limit orders via Jupiter's Trigger API — placing buy/sell orders at specific prices, viewing open orders, canceling orders, and executing signed transactions.

---

## Base URL & Auth

```
Base: https://api.jup.ag/trigger/v1
Auth: x-api-key header (required)
```

---

## How Limit Orders Work

Jupiter Trigger creates on-chain limit orders that execute automatically when the target price is reached. Jupiter's keeper network monitors prices and executes orders when conditions are met.

### Fees

- **Non-stable pairs**: 0.1% execution fee
- **Stable pairs** (e.g., USDC/USDT): 0.03% execution fee

Fees are deducted from the output amount at execution time.

### Minimums

- **Minimum order value**: $5 USD equivalent

---

## Endpoints

### POST /createOrder — Create Limit Order

```typescript
const response = await fetch('https://api.jup.ag/trigger/v1/createOrder', {
  method: 'POST',
  headers: {
    'x-api-key': process.env.JUPITER_API_KEY!,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    payer: walletPublicKey,
    params: {
      inputMint: 'So11111111111111111111111111111111111111112', // SOL
      outputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
      makingAmount: '1000000000', // 1 SOL in lamports
      takingAmount: '150000000', // 150 USDC (min output, sets the limit price)
      expiredAt: null, // null = no expiration (Good Till Cancelled)
      // Optional:
      // slippageBps: 50,
      // feeBps: 100,
    },
    // Optional:
    // feeAccount: referralFeeAccount,
    // computeUnitPrice: '50000',
  }),
});

const result = await response.json();
// Returns: { order, transaction, requestId }
```

**Top-level parameters**:
- `payer` — Wallet public key placing the order

**Params (nested inside `params`)**:
- `inputMint` — Token you're selling
- `outputMint` — Token you're buying
- `makingAmount` — Amount of input token (atomic units)
- `takingAmount` — Minimum amount of output token (atomic units) — this sets the limit price
- `expiredAt` — Unix timestamp for expiration, or `null` for GTC (Good Till Cancelled)
- `slippageBps` — (Optional) Slippage tolerance in basis points
- `feeBps` — (Optional) Referral fee in basis points

**Optional top-level**:
- `feeAccount` — Referral fee account
- `computeUnitPrice` — Priority fee in micro-lamports

### Calculating Limit Price

The limit price is implied by the ratio of `takingAmount / makingAmount`:

```typescript
// Example: Buy SOL at $150
// Selling 150 USDC to get at least 1 SOL
const inputAmount = 150_000_000; // 150 USDC (6 decimals)
const outputAmount = 1_000_000_000; // 1 SOL (9 decimals)
// Implied price: 150 USDC per SOL
```

### GET /getTriggerOrders — List Orders

```typescript
const response = await fetch(
  `https://api.jup.ag/trigger/v1/getTriggerOrders?user=${walletPublicKey}&orderStatus=active`,
  { headers: { 'x-api-key': process.env.JUPITER_API_KEY! } }
);

const orders = await response.json();
// Returns array of orders with status, amounts, mints, etc.
```

**Parameters**:
- `user` — Wallet public key
- `orderStatus` — Required: `active` or `history`

### POST /cancelOrder — Cancel Order

```typescript
const response = await fetch('https://api.jup.ag/trigger/v1/cancelOrder', {
  method: 'POST',
  headers: {
    'x-api-key': process.env.JUPITER_API_KEY!,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    payer: walletPublicKey,
    order: orderAddressToCancel,
  }),
});

const cancelResult = await response.json();
// Returns: { transaction, requestId }
```

### POST /cancelOrders — Batch Cancel

Cancel multiple orders in a single transaction:

```typescript
const response = await fetch('https://api.jup.ag/trigger/v1/cancelOrders', {
  method: 'POST',
  headers: {
    'x-api-key': process.env.JUPITER_API_KEY!,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    payer: walletPublicKey,
    orders: [orderAddress1, orderAddress2],
  }),
});

const cancelResult = await response.json();
// Returns: { transaction, requestId }
```

### POST /execute — Submit Signed Transaction

After signing a transaction from `/createOrder` or `/cancelOrder`, submit it back to Jupiter:

```typescript
const executeResponse = await fetch('https://api.jup.ag/trigger/v1/execute', {
  method: 'POST',
  headers: {
    'x-api-key': process.env.JUPITER_API_KEY!,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    signedTransaction: base64SignedTx,
    requestId: result.requestId, // From /createOrder or /cancelOrder
  }),
});
```

---

## Transaction Flow

All Trigger API responses that modify state return `transaction` (base64-encoded) and `requestId`. You must:

1. Deserialize the transaction
2. Sign with the payer's keypair
3. Submit via `/execute` or Helius Sender (see `references/helius-sender.md`)

```typescript
import { VersionedTransaction, Keypair } from '@solana/web3.js';

const txBuffer = Buffer.from(result.transaction, 'base64');
const transaction = VersionedTransaction.deserialize(txBuffer);
transaction.sign([keypair]);

// Option A: Submit via Jupiter /execute
const signedTx = Buffer.from(transaction.serialize()).toString('base64');
await fetch('https://api.jup.ag/trigger/v1/execute', {
  method: 'POST',
  headers: {
    'x-api-key': process.env.JUPITER_API_KEY!,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    signedTransaction: signedTx,
    requestId: result.requestId,
  }),
});

// Option B: Submit via Helius Sender
const SENDER_URL = `https://sender.helius-rpc.com/fast?api-key=${HELIUS_API_KEY}`;
const sendRes = await fetch(SENDER_URL, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    jsonrpc: '2.0',
    id: '1',
    method: 'sendTransaction',
    params: [
      Buffer.from(transaction.serialize()).toString('base64'),
      { encoding: 'base64', skipPreflight: true, maxRetries: 0 },
    ],
  }),
});
```

---

## Common Pitfalls

1. **Minimum $5 order value** — Orders below this are rejected
2. **Amounts are in atomic units** — 1 SOL = 1_000_000_000 lamports, 1 USDC = 1_000_000
3. **takingAmount sets the limit price** — It's the minimum output, not the exact output
4. **Orders may partially fill** — Check order status for partial fills
5. **GTC orders persist indefinitely** — Set `expiredAt` if the user wants time-limited orders
6. **Params are nested** — `inputMint`, `outputMint`, etc. go inside `params`, not at the top level
7. **Use `payer` not `maker`** — The top-level field is `payer`

---

## Resources

- Trigger API Docs: [dev.jup.ag/docs/trigger](https://dev.jup.ag/docs/trigger)
