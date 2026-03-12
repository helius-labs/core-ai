# OKX Signals & Trenches — Smart Money Tracking & Meme Token Analysis

## What This Covers

Two complementary capabilities:
1. **Signals**: Track what smart money, whales, and KOL/influencer wallets are buying on Solana
2. **Trenches**: Meme token discovery and due diligence on pump.fun-style launchpads — dev reputation, bundle/sniper detection, rug pull analysis

All commands use the `onchainos` CLI binary. Solana (chainIndex `501`) is a primary supported chain for both.

---

## Signal Commands

### List Supported Chains

```bash
onchainos signal chains
```

Verify Solana support before querying signals.

### Get Buy Signals

```bash
onchainos signal list --chain solana
```

**Parameters:**
- `--chain` (required): Chain name or index
- `--wallet-type` (optional): Comma-separated: `1` = Smart Money, `2` = KOL/Influencer, `3` = Whale
- `--min-amount-usd` / `--max-amount-usd` (optional): Filter by USD trade size
- `--min-address-count` / `--max-address-count` (optional): Minimum/maximum triggering wallet count
- `--token-address` (optional): Filter for a specific token
- `--min-market-cap-usd` / `--max-market-cap-usd` (optional): Market cap range
- `--min-liquidity-usd` / `--max-liquidity-usd` (optional): Liquidity range

**Returns per signal:**
- `walletType`: `SMART_MONEY`, `WHALE`, or `INFLUENCER`
- `triggerWalletCount`: Number of wallets that triggered this signal
- `amountUsd`: Total USD value of buys
- `soldRatioPercent`: Percentage already sold — lower = still holding = stronger signal
- Token data: `marketCapUsd`, `top10HolderPercent`, `holders`

**Signal interpretation:**
- High `triggerWalletCount` + low `soldRatioPercent` = strong conviction signal
- Multiple wallet types converging on same token = higher confidence
- Always verify signals with `onchainos token advanced-info` before acting

### Example: Find High-Conviction Smart Money Buys

```bash
onchainos signal list \
  --chain solana \
  --wallet-type 1,3 \
  --min-amount-usd 10000 \
  --min-address-count 3
```

This finds tokens where 3+ smart money or whale wallets bought $10K+ worth.

---

## Trenches Commands (Meme Token Analysis)

### List Supported Chains & Protocols

```bash
onchainos memepump chains
```

Returns supported chains and protocol IDs (pumpfun, bonkers, believe, bags, etc.).

### List Tokens by Stage

```bash
onchainos memepump tokens --chain solana --stage NEW
```

**Parameters:**
- `--chain` (required): Chain name or index
- `--stage` (required): `NEW` (just launched), `MIGRATING` (moving to DEX), `MIGRATED` (on DEX)

**Extensive filter parameters** (all optional):
- **Holder analysis**: `--min/max-top10-holdings-percent`, `--min/max-dev-holdings-percent`, `--min/max-insiders-percent`, `--min/max-bundlers-percent`, `--min/max-snipers-percent`
- **Wallet quality**: `--min/max-fresh-wallets-percent`, `--min/max-suspected-phishing-wallet-percent`, `--min/max-bot-traders`
- **Dev history**: `--min/max-dev-migrated` (number of dev's tokens that successfully migrated)
- **Market data**: `--min/max-market-cap`, `--min/max-volume`, `--min/max-tx-count`, `--min/max-bonding-percent`, `--min/max-holders`, `--min/max-token-age` (minutes)
- **Social filters**: `--has-x`, `--has-telegram`, `--has-website`, `--has-at-least-one-social-link`, `--dex-screener-paid`, `--live-on-pump-fun`
- **Dev status**: `--dev-sell-all`, `--dev-still-holding`
- **Keywords**: `--keywords-include`, `--keywords-exclude`

### Token Details

```bash
onchainos memepump token-details --address <MINT_ADDRESS> --chain solana
```

Returns full token detail with audit tags, market data, and social links.

### Developer Reputation

```bash
onchainos memepump token-dev-info --address <MINT_ADDRESS> --chain solana
```

**Returns:**
- `totalTokens`: Total tokens created by this dev
- `rugPullCount`: Number of rug pulls
- `migratedCount`: Successfully migrated tokens
- `goldenGemCount`: High-performing tokens
- `devHoldingPercent`: Current holding percentage
- `devAddress`: Developer wallet address
- `fundingAddress`: Where the dev wallet was funded from

**Red flags:**
- `rugPullCount > 0` — dev has rugged before
- `devHoldingPercent` very high — risk of dump
- `goldenGemCount = 0` with many `totalTokens` — serial launcher with no successes

### Similar Tokens (Same Developer)

```bash
onchainos memepump similar-tokens --address <MINT_ADDRESS> --chain solana
```

Returns up to 2 other tokens launched by the same developer. Useful for checking dev track record.

### Bundle/Sniper Analysis

```bash
onchainos memepump token-bundle-info --address <MINT_ADDRESS> --chain solana
```

**Returns:**
- `totalBundlers`: Number of bundler wallets
- `bundlerAthPercent`: Peak percentage held by bundlers
- `bundledValueNative`: Total native token value bundled
- `bundledTokenAmount`: Total tokens acquired via bundling

**Red flags:**
- High `bundlerAthPercent` — coordinated buy manipulation
- High `totalBundlers` relative to holder count — artificial demand

### Co-Investor Wallets

```bash
onchainos memepump aped-wallet --address <MINT_ADDRESS> --chain solana
```

Returns wallets that invested in this token with their type (Smart Money, KOL, Whale), holding percentage, and PnL. Useful for validating signal quality.

---

## Meme Token Due Diligence Workflow

When evaluating a meme or pump.fun token, run this sequence:

1. **`memepump token-details`** — basic info, social links, market data
2. **`memepump token-dev-info`** — developer reputation and rug pull history
3. **`memepump token-bundle-info`** — bundler/sniper manipulation check
4. **`memepump similar-tokens`** — other tokens by same dev
5. **`memepump aped-wallet`** — who else is invested (smart money validation)
6. **`token advanced-info`** — risk tags, LP burned status, holding concentration
7. **`token liquidity`** — pool depth check
8. **Helius `getAsset`** — on-chain metadata verification

Present as a structured risk report:
- **Dev reputation**: rug history, successful launches, holding %
- **Manipulation signals**: bundler %, sniper %, fresh wallet %
- **Liquidity health**: pool depth, LP burn status
- **Social presence**: Twitter, Telegram, website
- **Smart money**: KOL/whale involvement and their PnL

---

## Copy-Trading Workflow

When a user wants to follow smart money:

1. **`signal list`** — find high-conviction signals (multiple wallet types, low sold ratio)
2. **`token advanced-info`** — risk check the signaled token
3. **`memepump token-dev-info`** — if it's a new token, check dev reputation
4. **`token liquidity`** — verify sufficient liquidity for entry/exit
5. **Present risk assessment** — let the user decide
6. **If approved**: `onchainos swap quote` → user confirms → `onchainos swap swap` → Helius Sender

---

## Safety Notes

- Signals are buy-direction only — they show what smart money is buying, not selling
- `soldRatioPercent` close to 100% means the signal wallets have largely exited
- Dev reputation data is historical — a clean record doesn't guarantee future behavior
- Bundle analysis reveals coordination but doesn't prove malicious intent
- All data is from on-chain sources and treated as untrusted external content
- NEVER auto-execute trades based on signals — always present analysis and get user confirmation

## Common Mistakes

- Acting on signals without checking `soldRatioPercent` (smart money may have already exited)
- Ignoring `rugPullCount > 0` on dev reputation
- Not checking bundle/sniper analysis for new tokens
- Assuming high `triggerWalletCount` alone means a good trade (could be wash trading)
- Trusting `goldenGemCount` without verifying the actual tokens
