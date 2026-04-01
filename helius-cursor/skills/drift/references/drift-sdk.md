# Drift SDK — Setup, Data API, Events, Keeper Bots

## What This Covers

Drift TypeScript SDK setup, DriftClient initialization, account subscription modes, Data API (REST + WebSocket), event subscriptions, keeper bots, and the self-hosted Gateway.

## SDK Installation

```bash
npm install @drift-labs/sdk @coral-xyz/anchor @solana/web3.js bn.js
```

Package: `@drift-labs/sdk` on npm. TypeDoc: `https://drift-labs.github.io/protocol-v2/sdk/`

## Initialization

```typescript
import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { Wallet } from '@coral-xyz/anchor';
import { DriftClient, initialize, BulkAccountLoader } from '@drift-labs/sdk';

const env = 'mainnet-beta'; // or 'devnet'
const sdkConfig = initialize({ env });

// Use Helius RPC for best performance
const connection = new Connection('https://mainnet.helius-rpc.com/?api-key=YOUR_KEY');
const wallet = new Wallet(Keypair.fromSecretKey(/* loaded from env or file */));

const bulkAccountLoader = new BulkAccountLoader(connection, 'confirmed', 1000);

const driftClient = new DriftClient({
  connection,
  wallet,
  programID: new PublicKey(sdkConfig.DRIFT_PROGRAM_ID),
  accountSubscription: {
    type: 'polling',
    accountLoader: bulkAccountLoader,
  },
});

// MUST call subscribe before any trading operations
await driftClient.subscribe();
```

## Account Subscription Modes

| Mode | Config | Latency | Use Case |
|------|--------|---------|----------|
| **polling** | `{ type: 'polling', accountLoader }` | Higher (poll interval) | Default, works with any RPC |
| **websocket** | `{ type: 'websocket' }` | Lower | Moderate latency needs |
| **grpc** | `{ type: 'grpc', grpcConfigs }` | Sub-second | HFT, requires gRPC-enabled RPC (Helius supports this) |

For most applications, use `polling` with `BulkAccountLoader`. Switch to `grpc` for latency-critical bots.

## Initializing a New User Account

First-time users must create an on-chain Drift account:

```typescript
const usdcMint = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
const ata = await getAssociatedTokenAddress(usdcMint, wallet.publicKey);

const [txSig, userPublicKey] = await driftClient.initializeUserAccountAndDepositCollateral(
  new BN(100).mul(QUOTE_PRECISION), // initial USDC deposit
  ata
);
```

## Data API (REST)

**Base URL**: `https://data.api.drift.trade`
**Playground**: `https://data.api.drift.trade/playground/json`
**Rate Limit**: 600 requests/minute (429 on exceeded)

### Key Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/market/{symbol}/trades` | Recent trades for a market |
| GET | `/market/{symbol}/candles/{resolution}` | OHLC candles (1, 5, 15, 60, 240, D, W, M) |
| GET | `/market/{symbol}/fundingRates` | Funding rate history |
| GET | `/amm/bidAskPrice` | AMM bid/ask prices for all markets |
| GET | `/amm/oraclePrice` | Oracle prices for all markets |
| GET | `/amm/openInterest` | Open interest for all markets |
| GET | `/stats/markets` | Aggregate market statistics |
| GET | `/stats/markets/volume/{interval}` | Volume by interval |
| GET | `/stats/leaderboard` | Trader leaderboard |
| GET | `/stats/liquidations` | Liquidation statistics |
| GET | `/authority/{id}/accounts` | User account info (BETA) |

### Example: Fetch SOL-PERP Candles

```typescript
const res = await fetch('https://data.api.drift.trade/market/SOL-PERP/candles/60');
const data = await res.json();
const candles = data.records || [];
// Each: { ts, fillOpen, fillHigh, fillLow, fillClose, quoteVolume, baseVolume }
```

## DLOB WebSocket (Real-Time Orderbook & Trades)

For real-time orderbook and trade data, use the DLOB WebSocket (see `drift-perps.md` for full details):

**URL**: `wss://dlob.drift.trade/ws`

```typescript
const ws = new WebSocket('wss://dlob.drift.trade/ws');
ws.onopen = () => {
  ws.send(JSON.stringify({ type: 'subscribe', marketType: 'perp', channel: 'orderbook', market: 'SOL-PERP' }));
};
ws.onmessage = (msg) => {
  const data = JSON.parse(msg.data);
  console.log(data);
};
```

Supported channels: `orderbook`, `trades`. For historical candle data, use the REST Data API endpoints.

## Event Subscriptions (SDK)

Track on-chain events using `EventSubscriber` with the event emitter pattern:

```typescript
import { EventSubscriber, isVariant } from '@drift-labs/sdk';

const eventSubscriber = new EventSubscriber(connection, driftClient.program, {
  commitment: 'confirmed',
});

await eventSubscriber.subscribe();

// Listen for new events via the event emitter
eventSubscriber.eventEmitter.on('newEvent', (event) => {
  if (event.eventType === 'OrderActionRecord' && isVariant(event.action, 'fill')) {
    console.log(`Fill: market ${event.marketIndex}, size ${event.baseAssetAmountFilled}`);
  }
});

// Available event types:
// OrderActionRecord, DepositRecord, FundingPaymentRecord, LiquidationRecord
```

## Swift (Offchain Signed Orders)

Swift enables placing orders without submitting a Solana transaction. Users sign an order message offchain and submit it to the Drift-operated Swift relayer, which forwards it to keepers for on-chain execution.

**Endpoint**: `POST https://swift.drift.trade/orders`

Swift requires the `@drift-labs/sdk` `SwiftOrderSubscriber` class and wallet keypair signing. The relayer is operated by Drift and may have availability constraints. Refer to the [Drift Swift docs](https://docs.drift.trade/developers/drift-sdk/swift) for the current API format and authentication requirements.

Note: Swift is a separate execution path from standard on-chain orders. Standard `placePerpOrder` via Helius Sender is recommended for most use cases. Use Swift only when you need to avoid Solana transaction fees or achieve faster order routing.

## Drift Gateway (Self-Hosted REST)

A self-hosted REST API server for programmatic trading. Useful for non-TypeScript environments.

**Repository**: `github.com/drift-labs/gateway`
**Default port**: 8080

```bash
# Start gateway
export DRIFT_GATEWAY_KEY=<base58-private-key>
drift-gateway --env mainnet --port 8080
```

### Gateway Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/v2/markets` | All markets |
| GET | `/v2/positions` | Current positions |
| GET | `/v2/orders` | Open orders |
| POST | `/v2/orders` | Place order |
| PATCH | `/v2/orders` | Modify order |
| DELETE | `/v2/orders` | Cancel order(s) |
| PUT | `/v2/orders` | Atomic cancel/modify/place |
| GET | `/v2/leverage` | Current leverage |
| GET | `/v2/collateral` | Collateral info |

## Keeper Bots

Reference implementation: `github.com/drift-labs/keeper-bots-v2`

| Bot | Purpose | Collateral Required |
|-----|---------|-------------------|
| Order Filler | Matches/fills orders from DLOB | No |
| Trigger Bot | Triggers stop-loss and take-profit orders | No |
| Liquidation Bot | Liquidates underwater accounts | Yes |
| JIT Maker Bot | Fills taker orders during JIT auctions | Yes |
| Funding Rate Bot | Updates hourly funding rates | No |

## Cleanup

Always unsubscribe when shutting down:

```typescript
await driftClient.unsubscribe();
await eventSubscriber.unsubscribe();
```
