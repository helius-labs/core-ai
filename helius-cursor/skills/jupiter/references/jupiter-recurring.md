# Jupiter Recurring API — Dollar-Cost Averaging (DCA)

## What This Covers

Recurring token purchases via Jupiter's Recurring API — setting up DCA orders, viewing active orders, and canceling orders.

---

## Base URL & Auth

```
Base: https://api.jup.ag/recurring/v1
Auth: x-api-key header (required)
```

---

## How DCA Works

Jupiter Recurring creates on-chain DCA orders that automatically execute at regular intervals. Jupiter's keeper network handles the periodic execution.

### Fees

- **0.1% execution fee** per individual order execution
- Fees are deducted from the output amount at each execution

### Minimums

- **Minimum total order value**: $100 USD equivalent
- Orders below this minimum will be rejected

---

## Endpoints

### POST /order — Create DCA Order

```typescript
const response = await fetch('https://api.jup.ag/recurring/v1/order', {
  method: 'POST',
  headers: {
    'x-api-key': process.env.JUPITER_API_KEY!,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    maker: walletPublicKey,
    inputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
    outputMint: 'So11111111111111111111111111111111111111112', // SOL
    totalInputAmount: '500000000', // 500 USDC total
    frequency: 'weekly', // or 'daily', 'monthly'
    numberOfOrders: 10, // Split into 10 executions (50 USDC each)
  }),
});

const order = await response.json();
// Returns: { transaction, ... }
```

**Parameters**:
- `maker` — Wallet public key
- `inputMint` — Token you're spending (e.g., USDC)
- `outputMint` — Token you're buying (e.g., SOL)
- `totalInputAmount` — Total amount to spend across all executions (atomic units)
- `frequency` — Execution interval: `daily`, `weekly`, or `monthly`
- `numberOfOrders` — Number of individual executions to split the total into

### Calculating Per-Execution Amount

```typescript
const totalUsdc = 500_000_000; // 500 USDC
const numberOfOrders = 10;
const perExecution = totalUsdc / numberOfOrders; // 50 USDC per execution
```

### GET /orders — List Active DCA Orders

```typescript
const response = await fetch(
  `https://api.jup.ag/recurring/v1/orders?wallet=${walletPublicKey}`,
  { headers: { 'x-api-key': process.env.JUPITER_API_KEY! } }
);

const orders = await response.json();
// Returns array of active DCA orders with progress, next execution time, etc.
```

### POST /cancel — Cancel DCA Order

```typescript
const response = await fetch('https://api.jup.ag/recurring/v1/cancel', {
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

Canceling a DCA order returns any unspent input tokens to the maker's wallet.

---

## Transaction Flow

Same as Trigger API — all state-modifying responses return a `transaction` to sign and submit via Helius Sender. See `references/jupiter-trigger.md` for the signing/submission pattern.

---

## Common Pitfalls

1. **Minimum $100 total** — Orders below this are rejected
2. **Amounts are in atomic units** — 500 USDC = 500_000_000
3. **Unspent funds returned on cancel** — Remaining input tokens go back to the wallet
4. **Each execution is a separate swap** — Price varies per execution (that's the point of DCA)
5. **Frequency determines the schedule** — The keeper network handles timing; you don't need to trigger executions manually

---

## Resources

- Recurring API Docs: [dev.jup.ag/docs/recurring](https://dev.jup.ag/docs/recurring)
