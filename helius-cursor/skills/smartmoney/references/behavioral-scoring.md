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
score = 0.25 * activity
      + 0.20 * diversification
      + 0.20 * recency
      + 0.20 * volume
      + 0.15 * holdAge
```

All components are 0-100. Composite is 0-100. Weights sum to 1.0.

This formula is **deterministic** — same inputs always yield the same score. It's also exposed via the routed MCP action `scoreWallet({ address, lookbackDays })`.

## Components

### activity (0-100)

How many transactions in the lookback window?

```
txCount = getWalletHistory(addr, lookbackDays).length
activity = min(100, txCount * 100 / (lookbackDays * 2))
// caps at 2 tx/day = 100
```

Captures: is this wallet an active trader vs a passive holder vs dormant?

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

### volume (0-100)

Cumulative USD volume in lookback window, log-scaled.

```
transfers = getWalletTransfers(addr, lookbackDays)
totalUsd = sum(transfers.map(t => t.amountUsd))
volume = min(100, log10(max(1, totalUsd)) * 20)
// $1     → 0
// $1k    → 60
// $100k  → 100
```

Captures: meaningful capital deployment vs micro-volume noise. Log scale so $10k and $1M aren't 100x apart in the score.

### holdAge (0-100)

How long has this wallet existed?

```
firstSig = getWalletHistory(addr, limit=1, order=asc)[0].slot
ageDays = (currentSlot - firstSig) * 0.4 / 86400
holdAge = min(100, ageDays / 3.65)
// 1 year = 100
```

Captures: not a brand-new wallet that might be a one-shot disposable. Established wallets have skin in the game.

## Why this formula

1. **Deterministic and auditable.** No opaque ML model. Users can recompute it themselves and challenge the score.
2. **Resilient to gaming.** Each component requires real on-chain activity costing real fees. Hard to fake.
3. **Composes well.** Each component is independently meaningful, so users can re-weight for their use case (e.g., "I only care about recency × volume").
4. **No price oracle dependency.** All inputs come from Helius primitives.

## Variations

### Custom weights

Different users want different definitions. Expose the weights as parameters:

```ts
scoreWallet({
  address,
  lookbackDays: 30,
  weights: { activity: 0.4, recency: 0.4, volume: 0.2 } // mostly active+recent
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

If a wallet's `volume` is high but the same set of counterparties appears repeatedly in its `getWalletTransfers`, the volume may be wash. Flag if:

```
top3CounterpartiesShare > 0.6 // 60%+ of volume to same 3 wallets
&& sumOfRoundTrips > 0.3 // and lots of back-and-forth
```

### Coordinated cluster gaming

If many wallets in a discovery set were funded by the same source within the same week and have nearly identical activity patterns, they may be a fleet inflating each other's scores. Run `getWalletFundedBy` on all top candidates and check for shared funders.

### Burst-then-dormant

A wallet with `activity = 100` but a 50-day-old last tx is gaming activity by counting old behavior. The `recency` component handles this — but verify by inspecting the activity histogram (per-day counts) over the lookback.

## Edge cases

### Brand new wallet

`holdAge = 0` may suppress otherwise good signals. For a wallet < 7 days old, return the score with a `flags: ["NEW_WALLET"]` annotation rather than penalize.

### Empty wallet (zero balances)

`getWalletBalances` returns no tokens → `diversification = 0` and `volume` may be low. The wallet might still have history; still compute, but flag `flags: ["EMPTY_WALLET"]`.

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
  volume: number;
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
  weights: Partial<ScoreComponents> = {}
): Promise<ScoreResult> {
  const helius = createHelius({ apiKey: process.env.HELIUS_API_KEY! });
  const flags: string[] = [];

  // Pull primitives in parallel
  const [history, balances, transfers, oldestTx] = await Promise.all([
    helius.wallet.getWalletHistory({ address, limit: lookbackDays * 5 }),
    helius.wallet.getWalletBalances({ address }),
    helius.wallet.getWalletTransfers({ address, limit: lookbackDays * 5 }),
    helius.wallet.getWalletHistory({ address, limit: 1, order: 'asc' }),
  ]);

  // Compute components (per the formulas above)
  const txCount = history.length;
  const activity = Math.min(100, (txCount * 100) / (lookbackDays * 2));

  const distinctTokens = balances.tokens?.filter(t => t.balanceUsd >= 1).length ?? 0;
  const diversification = Math.min(100, distinctTokens * 5);
  if (distinctTokens === 0) flags.push('EMPTY_WALLET');

  const lastSlot = history[0]?.slot ?? 0;
  const slotsSince = balances.currentSlot - lastSlot;
  const daysSince = (slotsSince * 0.4) / 86400;
  const recency = Math.max(0, 100 - daysSince * 5);

  const totalUsd = transfers.reduce((sum, t) => sum + (t.amountUsd ?? 0), 0);
  const volume = Math.min(100, Math.log10(Math.max(1, totalUsd)) * 20);

  const firstSlot = oldestTx[0]?.slot ?? balances.currentSlot;
  const ageDays = ((balances.currentSlot - firstSlot) * 0.4) / 86400;
  const holdAge = Math.min(100, ageDays / 3.65);
  if (ageDays < 7) flags.push('NEW_WALLET');

  const components: ScoreComponents = { activity, diversification, recency, volume, holdAge };

  // Apply weights
  const defaultWeights: ScoreComponents = {
    activity: 0.25, diversification: 0.20, recency: 0.20, volume: 0.20, holdAge: 0.15,
  };
  const w = { ...defaultWeights, ...weights };
  const wSum = Object.values(w).reduce((a, b) => a + b, 0);
  const normalized = Object.fromEntries(
    Object.entries(w).map(([k, v]) => [k, v / wSum])
  ) as ScoreComponents;

  const score = (Object.keys(components) as Array<keyof ScoreComponents>)
    .reduce((sum, k) => sum + components[k] * normalized[k], 0);

  return {
    address,
    score: Math.round(score),
    components,
    flags,
    asOf: new Date().toISOString(),
  };
}
```

## Cost per scoreWallet call

| Primitive | Calls | Credits |
|-----------|-------|---------|
| getWalletHistory (recent) | 1 | ~110 |
| getWalletBalances | 1 | ~100 |
| getWalletTransfers | 1 | ~100 |
| getWalletHistory (oldest) | 1 | ~110 |
| **Total per score** | 4 | ~420 |

For 100 candidates: ~42k credits. On Developer plan (~10k credits/sec rate limit), about 4 seconds wall time when calls are parallelized.

## Common pitfalls

- **Don't compare absolute scores across very different wallet types.** A score of 60 means very different things for an NFT-only wallet vs a memecoin trader. Use the score for relative ranking within a comparable cohort, not absolute classification.
- **The score lags real-time.** It uses lookback data; a wallet that just became hot won't show that yet. Use recency-weighted variants for "is this wallet hot RIGHT NOW".
- **Components are correlated.** activity and volume tend to move together; diversification and concentration are inversely related. The composite still ranks well, but don't double-count by adding redundant custom components.
- **Outliers exist.** A wallet that scores 95 may still rug your trade — score is statistical, not deterministic about the next trade. Always present the score with components so users see *why*.
