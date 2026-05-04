# Behavioral Scoring

A deterministic 0-100 quality score for any Solana wallet, computed entirely from Helius primitives. Used as the ranking backbone for token-anchored, seed-anchored, and provider-anchored discovery.

The score is **not a P&L estimate** — Helius doesn't have historical price oracles indexed per-wallet. It's a quality classifier: given a wallet, how trader-like, active, and survival-biased is it?

## When to use

- "Is this wallet good?"
- "Score this address"
- "Rank these wallets"
- As a **filter** on outputs from any other discovery vector

## Formula (v1)

```
score = 0.30 * activity
      + 0.25 * diversification
      + 0.25 * recency
      + 0.20 * holdAge
```

All components are 0-100. Composite is 0-100. Weights sum to 1.0.

This formula is **deterministic** — same inputs always yield the same score. It's also exposed via the routed MCP action `scoreWallet({ address, lookbackDays })`.

A USD-volume component is intentionally absent in v1: the Helius `Transfer` schema does not carry per-transfer USD values, so a meaningful `volume` score would require a separate price oracle integration. We considered SOL-only volume as a proxy and rejected it as misleading for non-SOL traders. v2 may add it once prices are sourced reliably.

## Components

### activity (0-100)

How many transactions **inside the lookback window**?

```
recent = getWalletHistory(addr).filter(tx => tx.timestamp >= now - lookbackDays * 86400)
txCount = recent.length
activity = min(100, txCount * 100 / (lookbackDays * 2))
// caps at 2 tx/day = 100
```

Important: filter to the window before counting. The default `getWalletHistory` page returns whatever fits in `limit`, which for old wallets covers far more than `lookbackDays`. If you count the whole page you over-credit dormant wallets that were active 6 months ago.

Captures: is this wallet an active trader **right now** vs a passive holder vs dormant?

### diversification (0-100)

How many distinct tokens does the wallet hold (or has touched)?

```
balances = getWalletBalances(addr)
distinctTokens = balances.tokens.filter(t => t.balanceUsd >= 1).length
diversification = min(100, distinctTokens * 5)
// caps at 20 tokens = 100
```

Captures: portfolio operator vs single-bet gambler. Highly-concentrated wallets get penalized — they may be smart, but they're not statistically robust.

### recency (0-100)

How recent is the most recent activity?

```
lastTxSlot = getWalletHistory(addr, limit=1)[0].slot
slotsSince = currentSlot - lastTxSlot
daysSince = slotsSince * 0.4 / 86400  // ~0.4s per slot
recency = max(0, 100 - daysSince * 5)
// 0 days = 100, 20 days = 0
```

Captures: still active or dormant? Stale wallets earn high activity scores from old behavior; recency is the dampener.

### holdAge (0-100)

How long has this wallet existed? Use `getWalletFundedBy` to get the timestamp of the wallet's first funding transaction — that's its true birth date.

```
funded = getWalletFundedBy(addr)
ageDays = funded?.timestamp ? (now - funded.timestamp) / 86400 : 0
holdAge = min(100, ageDays / 3.65)
// 1 year = 100
```

If `getWalletFundedBy` 404s (wallet's funding source can't be traced), fall back to the oldest tx in the current `getWalletHistory` page — but note that this **under-estimates** for wallets older than the page covers.

Captures: not a brand-new wallet that might be a one-shot disposable. Established wallets have skin in the game.

## Why this formula

1. **Deterministic and auditable.** No opaque ML model. Users can recompute it themselves and challenge the score.
2. **Resilient to gaming.** Each component requires real on-chain activity costing real fees. Hard to fake.
3. **Composes well.** Each component is independently meaningful, so users can re-weight for their use case (e.g., "I only care about recency × activity").
4. **No price oracle dependency.** All inputs come from Helius primitives.

## Variations

### Custom weights

Different users want different definitions. Expose the weights as parameters:

```ts
scoreWallet({
  address,
  lookbackDays: 30,
  weights: { activity: 0.5, recency: 0.5 } // mostly active+recent
})
```

If `weights` is partial, missing components use the defaults; weights are normalized to sum to 1.0.

### Lookback window

Default `lookbackDays = 30`. Useful alternatives:

- `7` — "this week's smart money"
- `90` — "this quarter"
- `365` — "lifetime"
- `1` — "live trading right now" (combine with recency emphasis)

### Domain-specific scores

For specialized use cases, compute additional components:

| Component | Inputs | Use case |
|-----------|--------|----------|
| `winRate` | parseTransactions on swap closures, count profitable/total | Memecoin trading skill |
| `concentration` | Top-1 holding share of portfolio | Detect single-bet wallets |
| `swapsPerWeek` | Filter parseTransactions for SWAP type | DeFi-active vs holder |
| `nftFlipRate` | DAS history + sale events | NFT trader signal |
| `liquidationFrequency` | parseTransactions for liquidation events | Risk profile |

Compute these in user code; surface only the ones relevant to their query.

## Anti-gaming heuristics

Detect wallets that game the score:

### Wash trading

The base score doesn't include volume, so direct wash-trading detection requires a separate pass over `getWalletTransfers`. If the same set of counterparties appears repeatedly, the activity may be circular. Flag if:

```
top3CounterpartiesShare > 0.6 // 60%+ of transfers to same 3 wallets
&& sumOfRoundTrips > 0.3      // and lots of back-and-forth
```

Run this as an out-of-band check on top candidates only — it doesn't fit cleanly into the deterministic 4-component score.

### Coordinated cluster gaming

If many wallets in a discovery set were funded by the same source within the same week and have nearly identical activity patterns, they may be a fleet inflating each other's scores. Run `getWalletFundedBy` on all top candidates and check for shared funders.

### Burst-then-dormant

A wallet with `activity = 100` but a 50-day-old last tx is gaming activity by counting old behavior. The `recency` component handles this — but verify by inspecting the activity histogram (per-day counts) over the lookback.

## Edge cases

### Brand new wallet

`holdAge = 0` may suppress otherwise good signals. For a wallet < 7 days old, return the score with a `flags: ["NEW_WALLET"]` annotation rather than penalize.

### Empty wallet (zero balances)

`getWalletBalances` returns no tokens → `diversification = 0`. The wallet might still have history; still compute, but flag `flags: ["EMPTY_WALLET"]`.

### Bot-like activity

Activity = 100, recency = 100, but token count = 1 and counterparties = 1 program → trading bot, not a trader. Score will be middling. Surface the components so user can see.

### Whale that holds

High balance but no transactions → activity = 0, recency = 0. Score will be low. That's correct — by this skill's definition of "smart money", buy-and-hold whales don't qualify. If the user wants whales, that's a balance query (`getTokenHolders`), not a score query.

## Implementation outline (TypeScript)

```ts
import { createHelius } from 'helius-sdk';

interface ScoreComponents {
  activity: number;
  diversification: number;
  recency: number;
  holdAge: number;
}

interface ScoreResult {
  address: string;
  score: number;
  components: ScoreComponents;
  flags: string[];
  asOf: string;
}

async function scoreWallet(
  address: string,
  lookbackDays: number = 30,
): Promise<ScoreResult> {
  const helius = createHelius({ apiKey: process.env.HELIUS_API_KEY! });
  const flags: string[] = [];
  const nowSec = Date.now() / 1000;

  const fetchLimit = Math.min(100, Math.max(20, lookbackDays * 3));
  const [history, balances, funded] = await Promise.all([
    helius.wallet.getHistory({ wallet: address, limit: fetchLimit }),
    helius.wallet.getBalances({ wallet: address, limit: 100, showNative: true }),
    helius.wallet.getFundedBy({ wallet: address }).catch(() => null),
  ]);

  // 1. Activity — txs in window
  const cutoff = nowSec - lookbackDays * 86400;
  const recent = history.data.filter(tx => tx.timestamp != null && tx.timestamp >= cutoff);
  const activity = Math.min(100, (recent.length * 100) / Math.max(1, lookbackDays * 2));

  // 2. Diversification
  const distinct = balances.balances.filter(t => (t.usdValue ?? 0) >= 1).length;
  const diversification = Math.min(100, distinct * 5);
  if (distinct === 0) flags.push('EMPTY_WALLET');

  // 3. Recency
  const lastTs = history.data[0]?.timestamp ?? null;
  const daysSince = lastTs != null ? (nowSec - lastTs) / 86400 : Infinity;
  const recency = isFinite(daysSince) ? Math.max(0, 100 - daysSince * 5) : 0;
  if (recent.length === 0) flags.push('NO_RECENT_ACTIVITY');

  // 4. Hold age — from first funding tx (true wallet birth)
  let ageDays = 0;
  if (funded?.timestamp) {
    ageDays = (nowSec - funded.timestamp) / 86400;
  } else {
    const oldest = history.data[history.data.length - 1]?.timestamp;
    if (oldest) ageDays = (nowSec - oldest) / 86400;
  }
  const holdAge = Math.min(100, ageDays / 3.65);
  if (ageDays > 0 && ageDays < 7) flags.push('NEW_WALLET');

  const components = { activity, diversification, recency, holdAge };
  const score = Math.round(
    activity * 0.30 +
    diversification * 0.25 +
    recency * 0.25 +
    holdAge * 0.20
  );

  return { address, score, components, flags, asOf: new Date().toISOString() };
}
```

## Cost per scoreWallet call

| Primitive | Calls | Credits |
|-----------|-------|---------|
| getWalletHistory | 1 | ~110 |
| getWalletBalances | 1 | ~100 |
| getWalletFundedBy | 1 | ~100 |
| **Total per score** | 3 | ~310 |

For 100 candidates: ~31k credits. On Developer plan (~10k credits/sec rate limit), about 3 seconds wall time when calls are parallelized.

## Common pitfalls

- **Don't compare absolute scores across very different wallet types.** A score of 60 means very different things for an NFT-only wallet vs a memecoin trader. Use the score for relative ranking within a comparable cohort, not absolute classification.
- **The score lags real-time.** It uses lookback data; a wallet that just became hot won't show that yet. Use recency-weighted variants for "is this wallet hot RIGHT NOW".
- **Components are correlated.** activity and recency move together; diversification and concentration are inversely related. The composite still ranks well, but don't double-count by adding redundant custom components.
- **Outliers exist.** A wallet that scores 95 may still rug your trade — score is statistical, not deterministic about the next trade. Always present the score with components so users see *why*.
