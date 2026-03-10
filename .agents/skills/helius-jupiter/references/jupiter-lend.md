# Jupiter Lend Protocol

## What This Covers

Jupiter Lend (powered by Fluid Protocol) — a lending and borrowing protocol on Solana. Covers liquidity pools, lending markets (jlTokens), vaults for leveraged positions, and both the read and write SDKs.

---

## Architecture

### Two-Layer Model

- **Liquidity Layer**: Foundational layer managing token limits, rate curves, and unified liquidity. Users never interact with this directly.
- **Protocol Layer**: User-facing modules (Lending and Vaults) that sit on top of the Liquidity Layer via Cross-Program Invocations (CPIs).

### Key Concepts

- **jlToken**: Yield-bearing token received when supplying to Lending (e.g., `jlUSDC`). Exchange rate increases as interest accrues.
- **Exchange Price**: Conversion rate between raw stored amounts and actual token amounts. Continuously increases.
- **Collateral Factor (CF)**: Maximum LTV ratio allowed when opening/managing positions.
- **Liquidation Threshold (LT)**: LTV at which a position becomes eligible for liquidation.
- **Liquidation Max Limit (LML)**: Absolute maximum LTV — positions exceeding this are absorbed by the protocol.
- **Sentinel Values**: `MAX_WITHDRAW_AMOUNT` and `MAX_REPAY_AMOUNT` — tell the protocol to calculate and use the maximum possible amount. Always use these for full withdrawals/repayments instead of trying to calculate exact amounts.

---

## SDKs

```bash
# Read operations (queries, prices, positions)
npm install @jup-ag/lend-read

# Write operations (transactions)
npm install @jup-ag/lend
```

No API key needed for on-chain SDK interactions — only an RPC connection.

---

## Reading Data (@jup-ag/lend-read)

### Initialize Client

```typescript
import { Client } from "@jup-ag/lend-read";
import { Connection, PublicKey } from "@solana/web3.js";

const connection = new Connection("YOUR_HELIUS_RPC_URL");
const client = new Client(connection);
```

**Important**: Use a Helius RPC URL for reliable access. The user's Helius API key provides the RPC endpoint.

### Liquidity Module — Rates and Pool Data

```typescript
const USDC = new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");

const data = await client.liquidity.getOverallTokenData(USDC);

// Rates in basis points (10000 = 100%)
const supplyApr = Number(data.supplyRate) / 100;
const borrowApr = Number(data.borrowRate) / 100;
```

### Lending Module — jlToken Markets

```typescript
// Get all jlToken details
const allDetails = await client.lending.getAllJlTokenDetails();

// Get user's jlToken balance
const position = await client.lending.getUserPosition(USDC, userPublicKey);
```

### Vault Module — Discovery and Positions

```typescript
// Discover all available vaults
const allVaults = await client.vault.getAllVaultsAddresses();
const totalVaults = await client.vault.getTotalVaults();

// Get vault data (config + state + rates + limits)
const vaultData = await client.vault.getVaultByVaultId(1);

// Check borrowing limits before prompting users
const borrowLimit = vaultData.limitsAndAvailability.borrowLimit;
const borrowable = vaultData.limitsAndAvailability.borrowable;
```

### Finding User Vault Positions

```typescript
const { userPositions_, vaultsData_ } = await client.vault.positionsByUser(userPublicKey);

for (let i = 0; i < userPositions_.length; i++) {
  console.log(`Position NFT ID: ${userPositions_[i].nftId}`);
  console.log(`Vault ID: ${vaultsData_[i].constantVariables.vaultId}`);
  console.log(`Collateral: ${userPositions_[i].supply}`);
  console.log(`Debt: ${userPositions_[i].borrow}`);
}
```

---

## Writing Data (@jup-ag/lend)

All write operations return `ixs` (instructions) and `addressLookupTableAccounts` (ALTs). You must wrap these in a **versioned (v0) transaction**.

### Lending — Earn (Deposit / Withdraw)

```typescript
import { getDepositIxs, getWithdrawIxs } from "@jup-ag/lend/earn";
import BN from "bn.js";

// Deposit 1 USDC (6 decimals)
const { ixs: depositIxs } = await getDepositIxs({
  amount: new BN(1_000_000),
  asset: USDC_PUBKEY,
  signer: userPublicKey,
  connection,
});

// Withdraw
const { ixs: withdrawIxs } = await getWithdrawIxs({
  amount: new BN(100_000),
  asset: USDC_PUBKEY,
  signer: userPublicKey,
  connection,
});
```

### Vaults — Borrow (Deposit Collateral / Borrow / Repay / Withdraw)

All vault operations use the single `getOperateIx` function. The direction is determined by the sign of `colAmount` and `debtAmount`:

| Operation | colAmount | debtAmount |
|---|---|---|
| Deposit collateral | > 0 | 0 |
| Withdraw collateral | < 0 (or `MAX_WITHDRAW_AMOUNT`) | 0 |
| Borrow | 0 | > 0 |
| Repay | 0 | < 0 (or `MAX_REPAY_AMOUNT`) |
| Deposit + Borrow | > 0 | > 0 |
| Repay + Withdraw | `MAX_WITHDRAW_AMOUNT` | `MAX_REPAY_AMOUNT` |

**`positionId: 0`** creates a new position NFT. Use an existing `nftId` (from the read SDK) to operate on an existing position.

```typescript
import { getOperateIx, MAX_WITHDRAW_AMOUNT, MAX_REPAY_AMOUNT } from "@jup-ag/lend/borrow";
import BN from "bn.js";

// Deposit collateral (new position)
const { ixs, addressLookupTableAccounts, positionId } = await getOperateIx({
  vaultId: 1,
  positionId: 0, // 0 = create new position
  colAmount: new BN(1_000_000),
  debtAmount: new BN(0),
  connection,
  signer: userPublicKey,
});

// Borrow against existing position
const { ixs: borrowIxs } = await getOperateIx({
  vaultId: 1,
  positionId: existingNftId,
  colAmount: new BN(0),
  debtAmount: new BN(500_000),
  connection,
  signer: userPublicKey,
});

// Full repay + withdraw (use sentinels)
const { ixs: closeIxs } = await getOperateIx({
  vaultId: 1,
  positionId: existingNftId,
  colAmount: MAX_WITHDRAW_AMOUNT,
  debtAmount: MAX_REPAY_AMOUNT,
  connection,
  signer: userPublicKey,
});
```

### Building and Sending Transactions

```typescript
import {
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";

// Build versioned transaction
const latestBlockhash = await connection.getLatestBlockhash();
const message = new TransactionMessage({
  payerKey: signer,
  recentBlockhash: latestBlockhash.blockhash,
  instructions: ixs,
}).compileToV0Message(addressLookupTableAccounts ?? []);

const transaction = new VersionedTransaction(message);
transaction.sign([keypair]);

// Submit via Helius Sender for optimal landing
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

### Combining Multiple Operations

When merging instructions from multiple `getOperateIx` calls, **deduplicate Address Lookup Tables**:

```typescript
const allAlts = [...alts1, ...alts2];
const seenKeys = new Set<string>();
const mergedAlts = allAlts.filter((alt) => {
  const k = alt.key.toString();
  if (seenKeys.has(k)) return false;
  seenKeys.add(k);
  return true;
});
```

---

## Program IDs (Mainnet)

| Program | Address |
|---|---|
| Liquidity | `jupeiUmn818Jg1ekPURTpr4mFo29p46vygyykFJ3wZC` |
| Lending | `jup3YeL8QhtSx1e253b2FDvsMNC87fDrgQZivbrndc9` |
| Lending Reward Rate Model | `jup7TthsMgcR9Y3L277b8Eo9uboVSmu1utkuXHNUKar` |
| Vaults | `jupr81YtYssSyPt8jbnGuiWon5f6x9TcDEFxYe3Bdzi` |
| Oracle | `jupnw4B6Eqs7ft6rxpzYLJZYSnrpRgPcr589n5Kv4oc` |
| Flashloan | `jupgfSgfuAXv4B6R2Uxu85Z1qdzgju79s6MfZekN6XS` |

---

## Common Pitfalls

1. **Don't calculate exact repay amounts** — Always use `MAX_REPAY_AMOUNT` sentinel for full repayment. Dust borrow amounts make exact calculation unreliable.
2. **Don't forget to deduplicate ALTs** — When combining multiple instructions, duplicate ALTs cause transaction failures.
3. **Always use versioned (v0) transactions** — Legacy transactions don't support Address Lookup Tables.
4. **Check borrowable limits before prompting users** — Use the read SDK to verify vault capacity.
5. **Use Helius RPC** — The Lend SDKs need an RPC connection. Helius provides reliable, high-performance endpoints.

---

## Resources

- Jupiter Lend Docs: [dev.jup.ag/docs/lend](https://dev.jup.ag/docs/lend)
- Read SDK: [@jup-ag/lend-read](https://www.npmjs.com/package/@jup-ag/lend-read)
- Write SDK: [@jup-ag/lend](https://www.npmjs.com/package/@jup-ag/lend)
- Lend Build Kit: [instadapp.mintlify.app](https://instadapp.mintlify.app)
- Smart Contracts: [github.com/Instadapp/fluid-solana-programs](https://github.com/Instadapp/fluid-solana-programs/)
