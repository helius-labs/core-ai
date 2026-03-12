# OKX Market Data — Prices, Charts & PnL Analysis

## What This Covers

Real-time price queries, OHLC candlestick data, index prices, and wallet PnL analysis on Solana. All commands use the `onchainos` CLI binary.

## Solana Notes

- Chain name: `solana`, chain index: `501`
- For SOL candlestick data, use the **wSOL SPL token address**: `So11111111111111111111111111111111111111112` (note: this is different from the native SOL address used in swaps)
- All amounts are displayed in UI units (e.g., SOL), not lamports

## Price Commands

### Single Token Price

```bash
onchainos market price --address <MINT_ADDRESS> --chain solana
```

Returns: chain ID, token address, timestamp, price in USD.

### Batch Prices

```bash
onchainos market prices --tokens "501:EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v,501:So11111111111111111111111111111111111111112"
```

**Parameters:**
- `--tokens` (required): Comma-separated `chainIndex:address` pairs
- `--chain` (optional): Default chain if addresses lack the `chainIndex:` prefix

Efficient for fetching multiple prices in one call.

### Index Price (Aggregated)

```bash
onchainos market index --address <MINT_ADDRESS> --chain solana
```

Returns an aggregated price from multiple DEX sources — more reliable than a single-DEX price. Use an empty string `""` for the address to get the native token (SOL) price.

## OHLC / Candlestick Data

```bash
onchainos market kline \
  --address So11111111111111111111111111111111111111112 \
  --bar 1H \
  --limit 100 \
  --chain solana
```

**Parameters:**
- `--address` (required): Token mint address (use wSOL address for SOL charts)
- `--bar` (optional, default `1H`): Candle size — `1s`, `1m`, `5m`, `15m`, `30m`, `1H`, `4H`, `1D`, `1W`
- `--limit` (optional, default 100, max 299): Number of data points
- `--chain` (optional, default `ethereum`)

**Returns array per candle:** timestamp, open, high, low, close, volume (token units), volume (USD), confirm flag (`"0"` = incomplete current candle, `"1"` = complete).

## Portfolio PnL Commands

### Check Supported Chains

```bash
onchainos market portfolio-supported-chains
```

Verify Solana is in the supported list before calling PnL endpoints.

### Portfolio Overview

```bash
onchainos market portfolio-overview --address <WALLET_ADDRESS> --chain solana --time-frame 7d
```

**Parameters:**
- `--address` (required): Wallet address
- `--chain` (required): Single chain name or ID
- `--time-frame` (optional, default `7d`): `1d`, `3d`, `7d`, `1m`, `3m`

**Returns:**
- `realizedPnlUsd`, `unrealizedPnlUsd`, `totalPnlUsd`, `totalPnlPercent`
- `winRate`: Percentage of profitable trades
- `buyTxCount`, `sellTxCount`, `buyVolumeUsd`, `sellVolumeUsd`
- `averageBuyValueUsd`
- `preferredMarketCap`: User's typical market cap range (bucket 1-5)
- `topPnlTokenList[]`: Top 3 tokens by PnL with amounts and percentages
- Token counts grouped by PnL range (>500%, 0-500%, -50%-0%, <-50%)

### DEX Transaction History

```bash
onchainos market portfolio-dex-history \
  --address <WALLET_ADDRESS> \
  --chain solana \
  --limit 50
```

**Parameters:**
- `--address` (required): Wallet address
- `--chain` (required): Single chain
- `--limit` (optional, default 20, max 100)
- `--cursor` (optional): For pagination
- `--token` (optional): Filter by token contract address
- `--tx-type` (optional): `1`=BUY, `2`=SELL, `3`=Transfer In, `4`=Transfer Out, `0`=All

**Returns per transaction:** type, chain, token address/symbol, USD value, amount, price, market cap at time of tx, PnL (USD), timestamp.

### Recent PnL by Token

```bash
onchainos market portfolio-recent-pnl \
  --address <WALLET_ADDRESS> \
  --chain solana \
  --limit 20
```

Returns paginated PnL per token: unrealized PnL (or `"SELL_ALL"` if fully sold), realized PnL, total PnL, token balance, position percentage, holding/selloff timestamps, buy/sell counts, average buy/sell prices.

### Per-Token PnL

```bash
onchainos market portfolio-token-pnl \
  --address <WALLET_ADDRESS> \
  --chain solana \
  --token <MINT_ADDRESS>
```

Returns PnL snapshot for one token: total PnL, unrealized PnL, realized PnL (all with percentages), `isPnlSupported` boolean.

## Display Rules

- Always show USD alongside token amounts
- Use 2 decimal places for high-value tokens (e.g., SOL: $142.50)
- Use significant digits for low-value tokens (e.g., BONK: $0.00001234)
- Show percentage changes with appropriate color/indicator (positive/negative)

## Common Patterns

### Token Price Check
1. `onchainos market price` for quick single price
2. `onchainos market index` for more reliable aggregated price
3. Show price in USD with 24h context from `onchainos token price-info`

### Chart Display
1. `onchainos market kline` with appropriate time frame
2. Present data as a table or describe the trend
3. Include volume data for context

### Wallet Performance Analysis
1. `portfolio-overview` for high-level PnL and win rate
2. `portfolio-recent-pnl` for per-token breakdown
3. `portfolio-dex-history` for detailed transaction log
4. Combine with Helius `getWalletBalances` for current holdings with USD values

## Common Mistakes

- Using native SOL address (`111...1`) for candlestick data — use wSOL (`So111...112`) instead
- Forgetting `--chain solana` flag (defaults to ethereum)
- Confusing UI units (SOL) with atomic units (lamports) — market data returns UI units, swap commands use atomic units
- Not paginating `dex-history` results (max 100 per page)
