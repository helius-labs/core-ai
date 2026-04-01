# Drift Spot & Margin Trading — Spot Markets, Deposits, Withdrawals

## What This Covers

Drift spot trading on Solana: token swaps with up to 5x margin, cross-margin and isolated margin modes, collateral deposits, and withdrawals.

## Spot Market Basics

Drift spot markets support trading SOL, BTC (wBTC), ETH (wETH), USDC, USDT, JTO, BONK, HNT, and many other tokens. Spot deposits automatically earn supply APY (see `drift-lending.md`).

**Cross-margin mode** (default): All deposited assets count as collateral. Profits from one position can offset losses in another.

**Isolated margin mode**: A single position is isolated with its own margin. Must disable cross-margin to use.

## Depositing Collateral

Before trading, deposit collateral into your Drift account:

```typescript
import { DriftClient, BN, QUOTE_PRECISION } from '@drift-labs/sdk';
import { getAssociatedTokenAddress } from '@solana/spl-token';

// Deposit 100 USDC (market index 0 = USDC)
const usdcMint = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
const ata = await getAssociatedTokenAddress(usdcMint, wallet.publicKey);

await driftClient.deposit(
  new BN(100).mul(QUOTE_PRECISION), // 100 USDC in atomic units
  0, // USDC spot market index
  ata
);
```

### Deposit SOL

```typescript
// Deposit 1 SOL (market index 1 = SOL)
await driftClient.deposit(
  new BN(1_000_000_000), // 1 SOL in lamports
  1, // SOL spot market index
  wallet.publicKey // SOL uses the wallet address directly
);
```

## Withdrawing Collateral

```typescript
// Withdraw 50 USDC
const ata = await getAssociatedTokenAddress(usdcMint, wallet.publicKey);

await driftClient.withdraw(
  new BN(50).mul(QUOTE_PRECISION),
  0, // USDC market index
  ata
);
```

Withdrawals are limited by free collateral. If you have open positions, you can only withdraw excess margin.

## Placing Spot Orders

### Market Buy

```typescript
import { getMarketOrderParams, PositionDirection,
         MarketType, BASE_PRECISION } from '@drift-labs/sdk';

const orderParams = getMarketOrderParams({
  marketIndex: 1, // SOL spot
  direction: PositionDirection.LONG,
  baseAssetAmount: new BN(10).mul(BASE_PRECISION), // 10 SOL
  marketType: MarketType.SPOT,
});

await driftClient.placeSpotOrder(orderParams);
```

### Limit Sell

```typescript
import { getLimitOrderParams, PRICE_PRECISION } from '@drift-labs/sdk';

const orderParams = getLimitOrderParams({
  marketIndex: 1, // SOL spot
  direction: PositionDirection.SHORT,
  baseAssetAmount: new BN(5).mul(BASE_PRECISION),
  price: new BN(160).mul(PRICE_PRECISION), // sell at $160
  marketType: MarketType.SPOT,
});

await driftClient.placeSpotOrder(orderParams);
```

## Querying Spot Positions

```typescript
import { getTokenAmount } from '@drift-labs/sdk';

const user = driftClient.getUser();
const spotPositions = user.getActiveSpotPositions();

for (const pos of spotPositions) {
  const market = driftClient.getSpotMarketAccount(pos.marketIndex);
  // getTokenAmount handles interest accrual and balance type (deposit vs borrow) correctly
  const tokenAmount = convertToNumber(
    getTokenAmount(pos.scaledBalance, market, pos.balanceType),
    new BN(10).pow(new BN(market.decimals))
  );
  console.log(`Market ${pos.marketIndex}: ${tokenAmount} tokens (${pos.balanceType})`);
}
```

## Initializing a New User Account

First-time users need to initialize a Drift user account:

```typescript
// Initialize account and deposit initial collateral (USDC)
const [txSig, userPublicKey] = await driftClient.initializeUserAccountAndDepositCollateral(
  new BN(100).mul(QUOTE_PRECISION), // 100 USDC initial deposit
  usdcTokenAccount
);
```

This creates an on-chain user account that stores positions, orders, and margin state.

## Common Spot Market Indices

| Index | Token | Decimals |
|-------|-------|----------|
| 0 | USDC | 6 |
| 1 | SOL | 9 |
| 2 | mSOL | 9 |
| 3 | wBTC | 8 |
| 4 | wETH | 8 |
| 5 | USDT | 6 |

Use `SpotMarkets` from the SDK or `driftClient.getSpotMarketAccount(index)` to get the full list dynamically.
