# Drift Lending & Borrowing — Supply APY, Borrow Rates, Utilization

## What This Covers

Drift overcollateralized lending on Solana: deposit tokens to earn supply APY, borrow against deposited collateral, interest rate mechanics, and utilization monitoring.

## How Lending Works

Every Drift spot deposit automatically earns supply APY. When you deposit USDC, SOL, or any supported token, it enters the lending pool. Borrowers pay interest that flows to depositors.

**No separate action required** — depositing via `driftClient.deposit()` automatically starts earning yield.

## Interest Rate Model

Interest rates are a function of **utilization ratio**:

```
Utilization = Total Borrowed / Total Deposits
```

- At low utilization: rates are low to encourage borrowing
- At optimal utilization (~80%): rates increase moderately
- Above optimal: rates spike sharply to incentivize repayment and new deposits

The specific rate curves vary per market and are configurable by governance.

## Querying Rates and Utilization

The SpotMarketAccount does not directly expose `depositRate` or `borrowRate` fields. Use the SDK helper functions to calculate rates from the on-chain interest model:

```typescript
import { DriftClient, convertToNumber, BN, QUOTE_PRECISION,
         SPOT_MARKET_RATE_PRECISION, SPOT_MARKET_BALANCE_PRECISION,
         calculateDepositRate, calculateBorrowRate,
         getTokenAmount, SpotBalanceType } from '@drift-labs/sdk';

const spotMarket = driftClient.getSpotMarketAccount(0); // USDC

// Calculate rates using SDK helper functions (not raw fields)
const depositRate = calculateDepositRate(spotMarket);
const borrowRate = calculateBorrowRate(spotMarket);

const depositAPY = convertToNumber(depositRate, SPOT_MARKET_RATE_PRECISION);
const borrowAPY = convertToNumber(borrowRate, SPOT_MARKET_RATE_PRECISION);

// Utilization: use the scaled balance fields with proper helpers
const totalDeposits = getTokenAmount(
  spotMarket.depositBalance,
  spotMarket,
  SpotBalanceType.DEPOSIT
);
const totalBorrows = getTokenAmount(
  spotMarket.borrowBalance,
  spotMarket,
  SpotBalanceType.BORROW
);
const utilization = totalBorrows.gt(new BN(0))
  ? convertToNumber(totalBorrows, SPOT_MARKET_BALANCE_PRECISION) /
    convertToNumber(totalDeposits, SPOT_MARKET_BALANCE_PRECISION)
  : 0;

console.log(`USDC — Supply APY: ${(depositAPY * 100).toFixed(2)}%, Borrow APY: ${(borrowAPY * 100).toFixed(2)}%, Utilization: ${(utilization * 100).toFixed(1)}%`);
```

## Borrowing

Borrowing happens implicitly when you trade or withdraw more than your deposited balance of a token. Drift uses cross-margin by default, so all your deposits serve as collateral.

```typescript
// Withdraw more than deposited = borrow
// If you have 100 USDC deposited but withdraw 150 USDC, you borrow 50 USDC
await driftClient.withdraw(
  new BN(150).mul(QUOTE_PRECISION),
  0, // USDC
  usdcAta
);
```

Borrowing is limited by your account's free collateral. Each token has a specific **asset weight** (how much collateral value it provides) and **liability weight** (how much borrowing power it costs).

## Repaying Borrows

Deposit the borrowed token to repay:

```typescript
// Repay by depositing back
await driftClient.deposit(
  new BN(50).mul(QUOTE_PRECISION), // repay 50 USDC
  0,
  usdcAta
);
```

## Data API for Lending Stats

```
GET https://data.api.drift.trade/stats/markets
```

The response is wrapped: `{ success: true, markets: [...] }`. Access the markets array via `response.markets`.

## Key Considerations

- Interest accrues continuously and compounds
- Borrowing increases your margin utilization and liquidation risk
- Each market has minimum and maximum borrow amounts
- Supply rates are typically lower than borrow rates (the spread funds the insurance fund)
- During high utilization, withdrawals may be temporarily limited if there is insufficient liquidity in the pool
