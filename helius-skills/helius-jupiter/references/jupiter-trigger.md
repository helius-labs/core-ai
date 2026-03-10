# Jupiter Trigger API — Limit Orders

## What This Covers

Limit orders via Jupiter's Trigger API — placing buy/sell orders at specific prices, viewing open orders, and canceling orders.

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

---

## Endpoints

### POST /order — Create Limit Order

```typescript
const response = await fetch('https://api.jup.ag/trigger/v1/order', {
  method: 'POST',
  headers: {
    'x-api-key': process.env.JUPITER_API_KEY!,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    maker: walletPublicKey,
    inputMint: 'So11111111111111111111111111111111111111112', // SOL
    outputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
    makingAmount: '1000000000', // 1 SOL in lamports
    takingAmount: '150000000', // 150 USDC (min output, sets the limit price)
    expiredAt: null, // null = no expiration (Good Till Cancelled)
  }),
});

const order = await response.json();
// Returns: { transaction, ... }
```

**Parameters**:
- `maker` — Wallet public key placing the order
- `inputMint` — Token you're selling
- `outputMint` — Token you're buying
- `makingAmount` — Amount of input token (atomic units)
- `takingAmount` — Minimum amount of output token (atomic units) — this sets the limit price
- `expiredAt` — Unix timestamp for expiration, or `null` for GTC (Good Till Cancelled)

### Calculating Limit Price

The limit price is implied by the ratio of `takingAmount / makingAmount`:

```typescript
// Example: Buy SOL at $150
// Selling 150 USDC to get at least 1 SOL
const inputAmount = 150_000_000; // 150 USDC (6 decimals)
const outputAmount = 1_000_000_000; // 1 SOL (9 decimals)
// Implied price: 150 USDC per SOL
```

### GET /orders — List Open Orders

```typescript
const response = await fetch(
  `https://api.jup.ag/trigger/v1/orders?wallet=${walletPublicKey}`,
  { headers: { 'x-api-key': process.env.JUPITER_API_KEY! } }
);

const orders = await response.json();
// Returns array of open orders with status, amounts, mints, etc.
```

### POST /cancel — Cancel Order

```typescript
const response = await fetch('https://api.jup.ag/trigger/v1/cancel', {
  method: 'POST',
  headers: {
    'x-api-key': process.env.JUPITER_API_KEY!,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    maker: walletPublicKey,
    orderId: orderIdToCancel,
  }),
});

const cancelResult = await response.json();
// Returns: { transaction, ... }
```

---

## Transaction Flow

All Trigger API responses that modify state return a `transaction` field (base64-encoded). You must:

1. Deserialize the transaction
2. Sign with the maker's keypair
3. Submit via Helius Sender (see `references/helius-sender.md`)

```typescript
import { VersionedTransaction, Keypair } from '@solana/web3.js';

const txBuffer = Buffer.from(order.transaction, 'base64');
const transaction = VersionedTransaction.deserialize(txBuffer);
transaction.sign([keypair]);

// Submit via Helius Sender
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

1. **Amounts are in atomic units** — 1 SOL = 1_000_000_000 lamports, 1 USDC = 1_000_000
2. **takingAmount sets the limit price** — It's the minimum output, not the exact output
3. **Orders may partially fill** — Check order status for partial fills
4. **GTC orders persist indefinitely** — Set `expiredAt` if the user wants time-limited orders

---

## Resources

- Trigger API Docs: [dev.jup.ag/docs/trigger](https://dev.jup.ag/docs/trigger)
