# Drift Perpetual Trading — Futures, JIT Auctions, Funding, Liquidation

## What This Covers

Drift perpetual futures on Solana: 40+ markets with up to 101x leverage, hybrid liquidity (JIT auctions + DLOB + AMM backstop), hourly funding rates, and iterative liquidation.

All trading uses the `@drift-labs/sdk` TypeScript SDK. See Prerequisites in SKILL.md for installation.

## Key Constants

- **Drift Program**: `dRiftyHA39MWEi3m9aunc5MzRF1JYuBsbn6VPcn33UH` (same on mainnet and devnet)
- **Precision**: `QUOTE_PRECISION = 10^6` (USD), `BASE_PRECISION = 10^9` (base asset), `PRICE_PRECISION = 10^6` (prices)
- **All amounts use BN (bn.js)** — never raw JavaScript numbers
- **Display conversion**: `convertToNumber(value, PRECISION)` — never manual division

## Available Markets

| Tier | Markets | Max Leverage | Max Hourly Funding |
|------|---------|-------------|-------------------|
| A | BTC-PERP | 101x | 0.125% |
| B | SOL-PERP, ETH-PERP | 101x | 0.125% |
| C | Most markets (default) | 20x | 0.208% |
| Speculative | 1MBONK-PERP, 1MPEPE-PERP, WIF-PERP | 20x | 0.4167% |

Full list at `https://docs.drift.trade/trading/market-specs`. Use `PerpMarkets['mainnet-beta']` from the SDK to get market indices programmatically (it is keyed by environment, not a flat array).

## Placing Perp Orders

### Market Order (Long)

```typescript
import { DriftClient, BN, BASE_PRECISION, PositionDirection,
         getMarketOrderParams, MarketType } from '@drift-labs/sdk';

const orderParams = getMarketOrderParams({
  marketIndex: 0, // SOL-PERP
  direction: PositionDirection.LONG,
  baseAssetAmount: new BN(1).mul(BASE_PRECISION), // 1 SOL
  marketType: MarketType.PERP,
});

const txSig = await driftClient.placePerpOrder(orderParams);
```

### Limit Order (Short)

```typescript
import { getLimitOrderParams, PRICE_PRECISION } from '@drift-labs/sdk';

const orderParams = getLimitOrderParams({
  marketIndex: 0, // SOL-PERP
  direction: PositionDirection.SHORT,
  baseAssetAmount: new BN(5).mul(BASE_PRECISION), // 5 SOL
  price: new BN(150).mul(PRICE_PRECISION), // $150 limit
  marketType: MarketType.PERP,
});

const txSig = await driftClient.placePerpOrder(orderParams);
```

### Stop-Loss / Take-Profit (Trigger Orders)

```typescript
import { getTriggerMarketOrderParams, OrderTriggerCondition } from '@drift-labs/sdk';

// Stop-loss: sell if price drops below $120
const stopLoss = getTriggerMarketOrderParams({
  marketIndex: 0,
  direction: PositionDirection.SHORT,
  baseAssetAmount: new BN(1).mul(BASE_PRECISION),
  marketType: MarketType.PERP,
  triggerPrice: new BN(120).mul(PRICE_PRECISION),
  triggerCondition: OrderTriggerCondition.BELOW,
});

await driftClient.placePerpOrder(stopLoss);
```

### Cancel Orders

```typescript
// Cancel a specific order
await driftClient.cancelOrder(orderId);

// Cancel all perp orders for a market
await driftClient.cancelOrders(MarketType.PERP, 0); // SOL-PERP

// Cancel all orders (WARNING: cancels ALL open orders including stop-losses and take-profits)
await driftClient.cancelOrders();
```

### Modify an Existing Order

```typescript
// modifyPerpOrder takes positional arguments: (orderId, newBaseAmount, newLimitPrice, newOraclePriceOffset)
await driftClient.modifyPerpOrder(
  existingOrderId,
  new BN(2).mul(BASE_PRECISION),  // new base amount
  new BN(145).mul(PRICE_PRECISION), // new limit price
  undefined // oracle price offset (optional)
);
```

## Querying Positions

```typescript
import { calculateEntryPrice } from '@drift-labs/sdk';

const user = driftClient.getUser();

// All perp positions
const perpPositions = user.getActivePerpPositions();

for (const pos of perpPositions) {
  const marketIndex = pos.marketIndex;
  const baseAmount = convertToNumber(pos.baseAssetAmount, BASE_PRECISION);
  // entryPrice is not a direct field — calculate from quoteEntryAmount / baseAssetAmount
  const entryPrice = convertToNumber(
    calculateEntryPrice(pos),
    PRICE_PRECISION
  );
  const unrealizedPnl = convertToNumber(
    user.getUnrealizedPNL(true, pos.marketIndex),
    QUOTE_PRECISION
  );
  console.log(`Market ${marketIndex}: ${baseAmount} @ $${entryPrice}, PnL: $${unrealizedPnl}`);
}

// Account health
const health = user.getHealth();
const totalCollateral = convertToNumber(user.getTotalCollateral(), QUOTE_PRECISION);
const freeCollateral = convertToNumber(user.getFreeCollateral(), QUOTE_PRECISION);
const leverage = convertToNumber(user.getLeverage(), new BN(10000)); // basis points
```

## JIT Auctions

Every market order routes through a 5-second Dutch auction before hitting the AMM.

**Buy order auction**: Price starts at AMM bid, linearly moves toward AMM intrinsic price. Makers compete to fill at or better than the auction price.

**Sell order auction**: Price starts at AMM ask, linearly moves toward AMM intrinsic price.

Partial fills are allowed. If no maker fills during the auction, the AMM fills at the end price (backstop liquidity).

### Making into JIT Auctions

To fill a taker's order during the JIT auction, use a PostOnly limit order that rests in the book and gets matched against incoming taker flow:

```typescript
import { getLimitOrderParams, OrderParams } from '@drift-labs/sdk';

// Place a resting maker order that earns rebates when filled
const makerOrder = getLimitOrderParams({
  marketIndex: 0,
  direction: PositionDirection.SHORT,
  baseAssetAmount: new BN(1).mul(BASE_PRECISION),
  price: new BN(148).mul(PRICE_PRECISION),
  marketType: MarketType.PERP,
  postOnly: true, // ensures maker-only execution
});

await driftClient.placePerpOrder(makerOrder);
```

For advanced JIT market-making (responding to specific taker orders), use the JIT Proxy SDK (`@drift-labs/jit-proxy`) which handles taker matching directly.

JIT Proxy program: `J1TnP8zvVxbtF5KFp5xRmWuvG9McnhzmBd9XGfCyuxFP`

## Funding Rates

Updated lazily every hour. When mark price > oracle price, longs pay shorts. When mark < oracle, shorts pay longs.

**Query current funding rate:**

```typescript
const perpMarket = driftClient.getPerpMarketAccount(0); // SOL-PERP
const fundingRate = convertToNumber(
  perpMarket.amm.lastFundingRate,
  PRICE_PRECISION
);
```

**Data API endpoint:**
```
GET https://data.api.drift.trade/market/SOL-PERP/fundingRates
```

Returns: `[{ ts, fundingRate, markPrice, oraclePrice, fundingRateLong, fundingRateShort }]`

Hourly magnitudes are clamped by contract tier (see Markets table above).

## DLOB (Decentralized Limit Order Book)

The DLOB aggregates all resting limit orders across the network. Connect via WebSocket for real-time orderbook data.

**WebSocket**: `wss://dlob.drift.trade/ws`

```json
{"type": "subscribe", "marketType": "perp", "channel": "orderbook", "market": "SOL-PERP"}
```

Response: `{ bids: [[price, size], ...], asks: [[price, size], ...] }`

```json
{"type": "subscribe", "marketType": "perp", "channel": "trades", "market": "SOL-PERP"}
```

Response: `{ price, size, side, ts, txSig, maker, taker }`

## Liquidation

Triggered when `totalCollateral < maintenanceMarginRequirement`.

**Process:**
1. Cancel all open orders and LP positions
2. Iterative liquidation at oracle prices + penalty fee
3. Continues until collateral exceeds `maintenanceMarginRequirement + liqBufferRatio`

**Liquidator rewards**: 0.75% to 3% of liquidated notional depending on market.

```typescript
// Check if an account is liquidatable
// canBeLiquidated() returns an object, not a boolean
const { canBeLiquidated, marginRequirement, totalCollateral } = user.canBeLiquidated();

if (canBeLiquidated) {
  // Execute liquidation (requires collateral in your own account)
  await driftClient.liquidatePerp(
    userAccountPublicKey,
    userAccount,
    marketIndex,
    maxBaseAssetAmount
  );
}
```

**Data API for liquidation stats:**
```
GET https://data.api.drift.trade/stats/liquidations
```

## Fee Structure

| Tier | 30D Volume | Taker Fee | Maker Rebate |
|------|-----------|-----------|-------------|
| 1 | up to $2M | 0.035% | -0.0025% |
| 2 | $2M+ | 0.030% | -0.0025% |
| 3 | $10M+ | 0.0275% | -0.0025% |
| 4 | $20M+ | 0.025% | -0.0025% |
| 5 | $80M+ | 0.0225% | -0.0025% |
| VIP | $200M+ | 0.020% | -0.0025% |

DRIFT token staking provides additional fee discounts (5% to 40% taker discount based on staking tier). High Leverage Mode sets taker fees to 2x the bottom fee tier.
