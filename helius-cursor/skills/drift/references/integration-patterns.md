# Helius x Drift Integration Patterns

Numbered patterns for combining Drift Protocol with Helius infrastructure. Each pattern includes the use case, architecture, and a working TypeScript example.

## Pattern 1: Perp Order Execution with Helius Sender

**Use case**: Place a perpetual order on Drift and submit via Helius Sender for optimal landing rates.

**Flow**: Build order with Drift SDK, extract the transaction, add priority fees via Helius, submit via Helius Sender.

```typescript
import { DriftClient, getMarketOrderParams, PositionDirection,
         MarketType, BASE_PRECISION, BN } from '@drift-labs/sdk';
import { Connection } from '@solana/web3.js';

// 1. Build the order instruction via Drift SDK
const orderParams = getMarketOrderParams({
  marketIndex: 0,
  direction: PositionDirection.LONG,
  baseAssetAmount: new BN(1).mul(BASE_PRECISION),
  marketType: MarketType.PERP,
});

// 2. Get priority fee estimate from Helius MCP
// Use getPriorityFeeEstimate tool with priorityLevel: 'high'

// 3. Build and sign the transaction
const tx = await driftClient.buildTransaction(
  await driftClient.getPlacePerpOrderIx(orderParams)
);

// 4. Submit via Helius Sender for best landing rates
// Use sendSmartTransaction or Helius Sender endpoint
// ALWAYS: skipPreflight: true, maxRetries: 0
```

## Pattern 2: Real-Time Position Monitoring with WebSockets

**Use case**: Monitor Drift positions in real time using Helius Enhanced WebSockets.

**Flow**: Subscribe to Drift user account changes via Helius WebSockets, parse position updates, display live PnL.

```typescript
// 1. Subscribe to the user's Drift account via Helius WebSocket
// Use accountSubscribe MCP tool on the Drift user account public key

// 2. On each account update, refresh positions
const user = driftClient.getUser();
const positions = user.getActivePerpPositions();

// 3. Calculate real-time PnL
for (const pos of positions) {
  const unrealizedPnl = convertToNumber(
    user.getUnrealizedPNL(true, pos.marketIndex),
    QUOTE_PRECISION
  );
  // Update dashboard
}
```

## Pattern 3: Liquidation Engine with LaserStream

**Use case**: Build a liquidation bot that detects underwater accounts at shred-level latency using Helius LaserStream.

**Flow**: LaserStream monitors Drift user accounts, detect margin violations, execute liquidation via Drift SDK, submit via Helius Sender.

```typescript
// 1. Subscribe to Drift user accounts via LaserStream
// Use laserstreamSubscribe MCP tool with Drift program filter
// Filter for accounts where margin ratio is approaching maintenance level

// 2. On each account update, check liquidation eligibility
// Must addUser first to load an arbitrary target into DriftClient's user map
await driftClient.addUser(0, targetAuthority); // subAccountId=0, authority=target wallet
const targetUser = driftClient.getUser(0, targetAuthority);
const { canBeLiquidated } = targetUser.canBeLiquidated();
if (canBeLiquidated) {
  // 3. Find the most profitable position to liquidate
  const perpPositions = targetUser.getActivePerpPositions();
  // Use BN comparison to avoid overflow with large position sizes
  const largest = perpPositions.sort(
    (a, b) => b.baseAssetAmount.abs().cmp(a.baseAssetAmount.abs())
  )[0];

  // 4. Execute liquidation — pass the target user's public key
  const targetUserAccountPubKey = await driftClient.getUserAccountPublicKey(0, targetAuthority);
  const txSig = await driftClient.liquidatePerp(
    targetUserAccountPubKey,
    targetUser.getUserAccount(),
    largest.marketIndex,
    largest.baseAssetAmount.abs()
  );

  // 5. Submit via Helius Sender with high priority fee
}
```

## Pattern 4: Funding Rate Arbitrage

**Use case**: Monitor funding rates across markets and take positions that earn funding payments.

**Flow**: Query funding rates via Data API, identify mispriced markets, open opposing positions, collect funding over time.

```typescript
// 1. Fetch current funding rates for all markets
// Response: { success: true, markets: [{ marketIndex, symbol, fundingRates: { 24h, 7d, 30d, 1y } }] }
const response = await fetch('https://data.api.drift.trade/stats/fundingRates');
const data = await response.json();
const markets = data.markets || [];

// 2. Identify markets with extreme funding
// fundingRates is an object with time-window keys, not an array
const opportunities = markets.filter(m => {
  const rate24h = m.fundingRates?.['24h'];
  return rate24h !== undefined && Math.abs(rate24h) > 0.01;
});

// 3. If funding is positive (longs pay shorts), go short to earn funding
// If funding is negative (shorts pay longs), go long to earn funding
for (const opp of opportunities) {
  const rate24h = opp.fundingRates['24h'];
  const direction = rate24h > 0
    ? PositionDirection.SHORT  // earn positive funding
    : PositionDirection.LONG;  // earn negative funding

  // 4. Place order via Drift SDK
  // 5. Monitor funding payments via EventSubscriber (FundingPaymentRecord)
  // 6. Use LaserStream to detect funding rate changes in real time
}
```

## Pattern 5: Prediction Market Dashboard

**Use case**: Build a UI showing live prediction market data with trading capabilities.

**Flow**: Drift Data API for market data, SDK for trading, Helius DAS for token metadata.

```typescript
// 1. Fetch available markets from Data API
// Response is wrapped: { success: true, markets: [...] }
const response = await fetch('https://data.api.drift.trade/stats/markets');
const data = await response.json();
const allMarkets = data.markets || [];

// 2. Filter for prediction/BET markets using SDK
// On-chain market accounts have contractType as an Anchor enum variant
const perpMarkets = driftClient.getPerpMarketAccounts();
const betMarkets = perpMarkets.filter(m =>
  isVariant(m.contractType, 'prediction')
);

// 3. Display market details using on-chain data
for (const market of betMarkets) {
  const oracle = driftClient.getOracleDataForPerpMarket(market.marketIndex);
  const markPrice = convertToNumber(market.amm.lastMarkPriceTwap, PRICE_PRECISION);
  // BET prices range 0-1, representing probability
  console.log(`Market ${market.marketIndex}: YES=${markPrice.toFixed(2)}, NO=${(1-markPrice).toFixed(2)}`);
}

// 4. For trading: use standard perp order placement
// Long = buy YES, Short = buy NO
// See drift-predictions.md for order examples

// 5. For user portfolio: use Helius getAssetsByOwner + Drift user positions
```

## Pattern 6: Portfolio Risk Dashboard

**Use case**: Build a comprehensive portfolio and risk dashboard combining Drift positions with Helius wallet data.

**Flow**: Drift SDK for position/margin data, Helius Wallet API for wallet holdings, Helius DAS for token metadata.

```typescript
// 1. Get Drift positions and margin
const user = driftClient.getUser();
const perpPositions = user.getActivePerpPositions();
const spotPositions = user.getActiveSpotPositions();
const health = user.getHealth();
const leverage = convertToNumber(user.getLeverage(), new BN(10000));
const totalCollateral = convertToNumber(user.getTotalCollateral(), QUOTE_PRECISION);
const freeCollateral = convertToNumber(user.getFreeCollateral(), QUOTE_PRECISION);

// 2. Get wallet holdings via Helius MCP
// Use getWalletBalances for SOL + token balances
// Use getAssetsByOwner with showFungible: true for full token list

// 3. Get wallet identity and history via Helius
// Use getWalletIdentity for identity resolution
// Use getWalletHistory for transaction history

// 4. Combine into a unified portfolio view
const portfolio = {
  drift: { perpPositions, spotPositions, health, leverage, totalCollateral, freeCollateral },
  wallet: { /* from Helius MCP tools */ },
  totalValue: totalCollateral + /* wallet SOL + token values */,
};
```
