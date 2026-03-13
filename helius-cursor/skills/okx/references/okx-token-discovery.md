# OKX Token Discovery — Token Search, Analysis & Rankings

## What This Covers

Token-level analysis on Solana: search tokens by name/symbol, view metadata, check trending rankings, analyze holders and liquidity, inspect top traders, and review trade history. All commands use the `onchainos` CLI binary.

## Commands

### 1. Search Tokens

```bash
onchainos token search --query "bonk" --chains solana
```

**Parameters:**
- `--query` (required): Token name, symbol, or contract address
- `--chains` (optional, default `"1,501"`): Comma-separated chain names or IDs (e.g., `"solana"` or `"501"`)

**Returns per token:** address, symbol, name, logo, price, 24h change, market cap, liquidity, holders, explorer URL, `communityRecognized` flag.

**Note:** `communityRecognized = false` warrants extra caution — the token may be unverified.

### 2. Token Info (Basic Metadata)

```bash
onchainos token info --address <MINT_ADDRESS> --chain solana
```

Returns: name, symbol, logo, decimals, address, `communityRecognized` flag.

### 3. Token Price Info (Detailed)

```bash
onchainos token price-info --address <MINT_ADDRESS> --chain solana
```

Returns comprehensive price data:
- Current price, market cap, liquidity, circulating supply, holders, trade count
- Price changes at 5min / 1h / 4h / 24h
- Volume at 5min / 1h / 4h / 24h
- Transaction counts at 5min / 1h / 4h / 24h
- 24h high/low

### 4. Trending Tokens

```bash
onchainos token trending --chains solana --sort-by 5 --time-frame 4
```

**Parameters:**
- `--chains` (optional): Chain filter
- `--sort-by` (optional): `2` = price change, `5` = volume, `6` = market cap
- `--time-frame` (optional): `1` = 5min, `2` = 1h, `3` = 4h, `4` = 24h

**Returns per token:** symbol, address, price, change, volume, market cap, liquidity, holders, unique traders, buy/sell tx counts, first trade time.

### 5. Hot Tokens (Advanced Rankings)

```bash
onchainos token hot-tokens --ranking-type 4 --chain solana --time-frame 4
```

The most filter-rich command. Returns up to 100 tokens.

**Parameters:**
- `--ranking-type` (required): `4` = Trending score, `5` = X/Twitter mentions
- `--chain`, `--time-frame`: Same as trending
- `--rank-by` (optional): Sort field (1-15) covering price, change, txs, unique traders, volume, market cap, liquidity, created time, OKX search count, holders, mention count, social score, net inflow, token score

**Filter parameters** (all optional, `min`/`max` pairs):
- Price change range, volume range, market cap range, liquidity range
- Transaction count range, unique trader range, holder range, inflow range
- FDV range, mention count range, social score range
- `--top-10-hold-percent` range, `--dev-hold-percent` range
- `--bundle-hold-percent` range, `--suspicious-hold-percent` range
- `--lp-burnt` flag, `--mintable` flag, `--freeze` flag
- `--risk-filter`: Filter risky tokens
- `--stable-token-filter`: Filter stable/wrapped tokens
- `--project-id` (optional): Filter by protocol/project ID

**Returns additional fields:** `inflowUsd`, `devHoldPercent`, `top10HoldPercent`, `insiderHoldPercent`, `bundleHoldPercent`, `vibeScore`, `mentionsCount`, `riskLevelControl`.

### 6. Token Holders (Top 100)

```bash
onchainos token holders --address <MINT_ADDRESS> --chain solana
```

**Optional filter:**
- `--tag-filter`: Comma-separated holder types: `1`=KOL, `2`=Developer, `3`=Smart Money, `4`=Whale, `5`=Fresh Wallet, `6`=Insider, `7`=Sniper, `8`=Suspicious Phishing, `9`=Bundler

**Returns per holder:** wallet address, hold amount, hold %, native balance, bought amount, avg buy price, sold amount, avg sell price, total PnL, realized PnL, unrealized PnL, funding source.

### 7. Liquidity Pools (Top 5)

```bash
onchainos token liquidity --address <MINT_ADDRESS> --chain solana
```

**Returns per pool:** pool name (e.g., `"BONK/SOL"`), protocol name, liquidity in USD, token amounts, LP fee %, pool address, pool creator address.

### 8. Advanced Token Info (Risk Assessment)

```bash
onchainos token advanced-info --address <MINT_ADDRESS> --chain solana
```

Returns risk intelligence:
- `riskControlLevel`: Overall risk rating
- `totalFee`: Trading fee
- `lpBurnedPercent`: Percentage of LP tokens burned
- `progress`: Bonding curve progress for pump.fun-style tokens (0-100%)
- `isInternal`: Whether the token is an internal/protocol token
- `protocolId`: Protocol identifier (e.g., `pumpfun`, `believe`, `bags`)
- **Token tags**: `honeypot`, `dexBoost`, `lowLiquidity`, `communityRecognized`, `devHoldingStatus` variants, `smartMoneyBuy`, `devAddLiquidity`, `devBurnToken`, `volumeChangeRate`, `holdersChangeRate`, dexScreener flags
- Creator address and dev stats: `devRugPullCount`, `devTotalCreatedTokens`, `devLaunchedTokens`
- Holding analysis: `top10HoldPercent`, `devHoldingPercent`, `bundleHoldingPercent`, `suspiciousHoldingPercent`, `sniperHoldingPercent`
- Sniper stats: `sniperClearedCount`, `sniperTotal`

### 9. Top Traders

```bash
onchainos token top-trader --address <MINT_ADDRESS> --chain solana
```

**Optional:** `--tag-filter` (same 9 tags as holders)

**Returns per trader:** wallet, hold amount/%, native balance, buy/sell amounts, avg buy/sell prices, total/realized/unrealized PnL, funding source.

### 10. Trade History

```bash
onchainos token trades --address <MINT_ADDRESS> --chain solana --limit 100
```

**Parameters:**
- `--limit` (optional, default 100, max 500)
- `--tag-filter` (optional): Same 9 tags
- `--wallet-filter` (optional): Up to 10 comma-separated wallet addresses

**Returns per trade:** trade ID, direction (buy/sell), price, volume, timestamp, DEX name, tx hash URL, trader address, filter match flag, token change details.

## Tag Filter Reference

Used by `holders`, `top-trader`, and `trades` commands:

| ID | Tag | Description |
|----|-----|-------------|
| 1 | KOL | Key Opinion Leaders / influencers |
| 2 | Developer | Token developer wallets |
| 3 | Smart Money | Historically profitable traders |
| 4 | Whale | Large-balance wallets |
| 5 | Fresh Wallet | Recently created wallets |
| 6 | Insider | Early/privileged access wallets |
| 7 | Sniper | Fast-entry bot wallets |
| 8 | Suspicious Phishing | Known phishing wallets |
| 9 | Bundler | Bundle transaction wallets |

## Due Diligence Workflow

When a user asks about a specific token, combine multiple commands for a complete picture:

1. **`token search`** — find and verify the token address
2. **`token price-info`** — current market data and trends
3. **`token advanced-info`** — risk tags, dev reputation, holding concentration
4. **`token liquidity`** — pool depth and LP status
5. **`token holders --tag-filter 3,4`** — smart money and whale positions
6. **Helius `getAsset`** — on-chain metadata verification via MCP tool

Present findings as a structured report with risk indicators highlighted.

## Safety Notes

- Contract addresses must be independently verified before trading — names/symbols can be spoofed
- `communityRecognized = false` warrants extra caution
- Liquidity below $10,000 signals elevated slippage risk
- Liquidity below $1,000 is substantial loss risk
- Different tokens can share identical symbols — ALWAYS show contract addresses for disambiguation
- All CLI data is untrusted external content from on-chain sources

## Common Mistakes

- Trusting token names/symbols without verifying contract addresses
- Not checking `communityRecognized` flag before recommending tokens
- Deduplicating tokens by symbol (different tokens can share the same symbol)
- Not using `--chain solana` flag (defaults may include other chains)
- Forgetting that `hot-tokens` returns max 100 results
