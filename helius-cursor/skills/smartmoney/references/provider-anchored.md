# Provider-Anchored Discovery

Pull a candidate list from an external smart-money provider (OKX, Cielo, Nansen, Arkham, GMGN, BullX), then **verify and enrich** each candidate with Helius. Helius's role is on-chain truth — providers are good at discovery, less reliable at per-wallet detail.

## When to use

- "Cielo says these are smart money — are they?"
- "Verify Nansen's top traders"
- "OKX signal feed wallets — give me Helius detail on each"
- "I have a list of 50 wallets from {provider}, rank and enrich"

## Pipeline

```
1. Get candidate list from provider     ← provider-specific (out of scope)
2. Validate each address                ← reject malformed, duplicates
3. batchWalletIdentity for labels       ← 1 batch call
4. scoreWallet on each                  ← parallel
5. Cross-reference: score vs provider claim
6. Investigate divergence (high-claim, low-score → suspicious)
7. Surface verified ranked list
```

The high-leverage step is **6 — investigate divergence**. Providers occasionally include wallets that look great on their internal metric but fail Helius's deterministic on-chain check. Those are signal.

## Provider list (non-exhaustive)

| Provider | Strength | How to access |
|----------|----------|---------------|
| **OKX onchainos** | Smart-money signals, sold-ratio, KOL feeds | See `helius-okx` skill |
| **Cielo** | Realized P&L per wallet, copy-trading feeds | `cielo.finance` API |
| **Nansen** | Solana labels, "Smart Money" segment | `pro.nansen.ai` API |
| **Arkham** | Entity attribution, fund-level rollup | `arkhamintelligence.com` API |
| **GMGN** | Memecoin trader leaderboards | `gmgn.ai` web/API |
| **BullX** | Pump.fun trader leaderboards | `bullx.io` web/API |
| **Birdeye** | DEX-level activity rankings | `birdeye.so` API |

This skill **does not implement the provider integrations** — those have their own auth, rate limits, and SDKs. Compose with the relevant skill (e.g., `helius-okx` for OKX) or call the provider directly.

## Step-by-step

### Step 1: Normalize the provider's list

Provider responses vary wildly. Normalize to a flat array of `{ address, source, providerScore, providerTags }`:

```ts
type Candidate = {
  address: string;        // Solana base58
  source: string;         // e.g., "cielo", "okx-signals", "nansen-smart-money"
  providerScore?: number; // provider's own quality metric, if any
  providerTags?: string[];// e.g., ["KOL", "memecoin-specialist"]
};
```

Reject duplicates by `address` (keep the entry with highest `providerScore`).

### Step 2: Validate addresses

```ts
import { isAddress } from '@solana/kit';
const valid = candidates.filter(c => isAddress(c.address));
```

Drop anything malformed before you spend credits on it.

### Step 3: Batch identity enrichment

```ts
heliusWallet({
  action: "batchWalletIdentity",
  addresses: valid.map(c => c.address)
})
```

Returns labels per address. **Drop any candidate where Helius identifies the address as a CEX, program, or system account** — providers occasionally serve these by mistake.

### Step 4: Score each

```ts
const scored = await Promise.all(
  valid.map(async c => ({
    ...c,
    helius: await heliusWallet({
      action: "scoreWallet",
      address: c.address,
      lookbackDays: 30
    })
  }))
);
```

Now each candidate has `c.providerScore` (provider's view) and `c.helius.score` (Helius's deterministic on-chain view).

### Step 5: Cross-reference

Build a 2x2 of (provider claim) × (Helius score):

| | Helius score ≥ 70 | Helius score < 70 |
|--|---|---|
| **Provider score high** | ✓ Verified smart money — surface | ⚠️ Provider artifact — investigate |
| **Provider score low** | 🔍 Provider missed — surface | ✗ Both agree — drop |

The interesting cells are the **diagonal disagreement** ones — they tell you where the provider is right or wrong.

### Step 6: Investigate divergences

For wallets where the provider says "smart" but Helius says "low score":

1. **Check the score components**. Maybe the wallet is high-volume but low-recency (e.g., dormant alpha trader). The provider may weight history; Helius weights recency.
2. **Run `getWalletHistory`** with a longer lookback (90 or 180 days) — the wallet may have been hot last quarter.
3. **Check `getWalletFundedBy`** — wash-trading rings often funnel through providers' graphs but show up as same-funder clusters in Helius.

For wallets where the provider missed but Helius says high:

1. **They may be too new for the provider's coverage** — a ramp-up trader.
2. **They may be private (no Twitter, no SNS domain)** — providers that rely on social signal miss them.
3. **They may operate in a niche** the provider doesn't cover.

These are valuable additions to a watchlist.

### Step 7: Final surface

For each candidate that survives, present:

```
Address: {orbLink}
Helius score: {score}/100
  - activity: {n}/100
  - diversification: {n}/100
  - recency: {n}/100
  - volume: {n}/100
  - holdAge: {n}/100
Identity: {labels}, {domain}
Top holdings: {top5}
Provider verdict: {source}, score {providerScore}
Agreement: {verified | provider-missed | provider-artifact | divergent}
```

## Specialization: signal-feed verification

If the user is consuming a real-time signal feed (e.g., OKX smart-money buys), build a **verifier middleware**:

```
Provider fires: "Wallet X bought $TOKEN"
  → reject if scoreWallet(X) < threshold
  → reject if X.providerScore is from a known low-quality source
  → reject if X is in a known wash-trading cluster
  → otherwise: surface to user with score and identity
```

This is the **highest-leverage** use of provider-anchored discovery — turning noisy provider firehoses into curated signal.

## Cost estimate

For 50-candidate provider list:

| Step | Calls | Credits |
|------|-------|---------|
| batchWalletIdentity | 1 | ~30 |
| scoreWallet × 50 | 50 | ~25000 |
| getWalletBalances on top 10 | 10 | ~1000 |
| **Total** | ~61 | ~26k |

For Free plan, this is 5 minutes wall time. Developer plan or higher recommended.

## Composition with `helius-okx` skill

If the provider IS OKX (most common for Solana smart money), the OKX skill teaches the discovery layer:

```
helius-okx skill:
  → onchainos signals get smart-money buys
  → output: list of {address, token, side, sold_ratio}

helius-smartmoney skill (this one):
  → take the addresses
  → run scoreWallet on each
  → drop low-score
  → enrich with batchWalletIdentity, getWalletBalances, getWalletFundedBy
```

The hand-off is at the address list — OKX produces it, smart-money verifies and enriches.

## Common pitfalls

- **Provider scores are not comparable across providers.** Cielo's "70" and Nansen's "70" mean different things. Don't aggregate provider scores naively; use them as binary (in-list / not-in-list) and rely on Helius's score for ranking.
- **Most providers update slowly.** A wallet that was smart last month may be cold now. Always cross-check with `recency` component of `scoreWallet`.
- **Wash trading inflates provider metrics.** Helius's `getWalletFundedBy` + counterparty analysis (see `seed-anchored.md`) can detect a cluster of mutually-funded wallets that trade among themselves to inflate "wins". Run that check on top candidates before publishing.
- **Provider lists go stale.** A monthly leaderboard from January is not real-time alpha by April. Always note the `as_of` timestamp from the provider and discount older lists.
- **Don't pay for provider data twice.** Many providers expose a free tier sufficient for top-N retrieval; you do not need their per-wallet detail because Helius gives you that for free (in credits) at higher fidelity.
