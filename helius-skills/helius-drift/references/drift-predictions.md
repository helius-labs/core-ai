# Drift BET Prediction Markets — Binary Outcomes on Solana

## What This Covers

Drift BET prediction markets: binary outcome trading (YES/NO), multi-collateral support (30+ tokens), lending yield on positions, and all order types (market, limit, stop).

## How BET Works

Drift BET offers binary prediction markets where prices represent probabilities:
- **YES token** = $1 if outcome occurs, $0 if not
- **NO token** = $1 if outcome does not occur, $0 if it does
- **Current price** = implied probability (e.g., YES at $0.65 = 65% chance)

Positions earn lending yield while held (unlike Polymarket where positions are idle).

## Key Differences from Polymarket

| Feature | Drift BET | Polymarket |
|---------|----------|------------|
| Collateral | 30+ tokens (SOL, USDC, BTC, etc.) | USDC only |
| Yield on positions | Yes (supply APY) | No |
| Order types | Market, limit, stop, trigger | Limit only |
| Chain | Solana | Polygon |
| Self-custody | Yes (Solana wallet) | Yes (Polygon wallet) |
| Leverage | Cross-margin with other Drift positions | No |

## Trading Prediction Markets

BET markets use the same perp trading interface with specific market indices. Prices range from $0.00 to $1.00.

### Buying YES (Bullish on Outcome)

```typescript
import { getMarketOrderParams, PositionDirection,
         MarketType, BASE_PRECISION } from '@drift-labs/sdk';

// Buy YES on a prediction market (long position)
const orderParams = getMarketOrderParams({
  marketIndex: 42, // specific BET market index
  direction: PositionDirection.LONG,
  baseAssetAmount: new BN(100).mul(BASE_PRECISION), // 100 contracts
  marketType: MarketType.PERP,
});

await driftClient.placePerpOrder(orderParams);
```

### Buying NO (Bearish on Outcome)

```typescript
// Buy NO = short the market
const orderParams = getMarketOrderParams({
  marketIndex: 42,
  direction: PositionDirection.SHORT,
  baseAssetAmount: new BN(100).mul(BASE_PRECISION),
  marketType: MarketType.PERP,
});

await driftClient.placePerpOrder(orderParams);
```

### Limit Order at Specific Odds

```typescript
import { getLimitOrderParams, PRICE_PRECISION } from '@drift-labs/sdk';

// Buy YES at $0.40 (40% implied probability)
const orderParams = getLimitOrderParams({
  marketIndex: 42,
  direction: PositionDirection.LONG,
  baseAssetAmount: new BN(200).mul(BASE_PRECISION),
  price: new BN(400000), // $0.40 in PRICE_PRECISION (6 decimals)
  marketType: MarketType.PERP,
});

await driftClient.placePerpOrder(orderParams);
```

## Querying Prediction Markets

### Data API

```
GET https://data.api.drift.trade/market/{symbol}/predictions
```

Returns paginated prediction records for the market (trade history, not a market summary). For current YES/NO prices, use the SDK to query the on-chain perp market account directly (see the SDK example below).

### Available Markets via SDK

```typescript
import { isVariant } from '@drift-labs/sdk';

// contractType is an Anchor enum variant, not a string — use isVariant to check
const perpMarkets = driftClient.getPerpMarketAccounts();
const betMarkets = perpMarkets.filter(m =>
  isVariant(m.contractType, 'prediction')
);
```

## Settlement

When a market resolves:
- **YES holders** receive $1 per contract if the outcome occurs
- **NO holders** receive $1 per contract if the outcome does not occur
- Settlement is automatic and on-chain

## App URL

Browse and trade prediction markets at `https://app.drift.trade/bet`

Categories include crypto, economics, politics, sports, and more.
