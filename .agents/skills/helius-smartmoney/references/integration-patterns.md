# Integration Patterns

End-to-end recipes that compose token-anchored, seed-anchored, provider-anchored, and behavioral-scoring vectors into complete smart-money workflows.

## Pattern 1: Token-themed copy list

**Use case**: User says "I want to follow the smart money on memecoins this week."

**Pipeline**:

```
Theme: memecoins (user-provided)
  → list of trending tokens   (helius-okx skill)
  → for each token:
      → token-anchored discovery (top-30 wallets by realized P&L)
  → union all candidate wallets
  → scoreWallet on each (lookback=30)
  → drop score < 70
  → seed-anchored expansion on top-5 (find their alt-wallets)
  → final ranked watchlist
```

**Code outline**:

```ts
// 1. Get trending memecoins (from OKX, Birdeye, or pump.fun graduates)
const tokens = await getTrendingMemes({ window: '7d', limit: 10 });

// 2. Token-anchored discovery, parallel
const candidates = await Promise.all(
  tokens.map(t => discoverByToken(t.mint, { topN: 30 }))
).then(arr => arr.flat());

// 3. Dedupe by address
const unique = Array.from(new Map(candidates.map(c => [c.address, c])).values());

// 4. Score
const scored = await Promise.all(
  unique.map(c => heliusWallet({ action: 'scoreWallet', address: c.address }))
);

// 5. Filter and rank
const winners = scored.filter(s => s.score >= 70).sort((a, b) => b.score - a.score);

// 6. Seed-anchored expansion on top-5 (for alt-wallets)
const top5 = winners.slice(0, 5);
const expanded = await Promise.all(top5.map(s => expandSeed(s.address)));

// 7. Final watchlist (top 5 + their high-coherence siblings)
const watchlist = mergeAndDedupe(winners.slice(0, 20), expanded.flat().filter(e => e.coherence > 0.6));
```

**Output**: 20-50 wallets, each with score, top holdings, and their themed concentration.

---

## Pattern 2: KOL cluster mapping

**Use case**: "I follow @cobie. Find his trader cluster and any alt-wallets he might operate."

**Pipeline**:

```
Seed: @cobie's known wallet
  → seed-anchored discovery
      → find funder
      → find sibling wallets (funded by same source)
      → find frequent counterparties
  → score every candidate
  → cluster by behavioral similarity (token overlap)
  → present: confirmed cluster, possible alts, peripheral counterparties
```

**Code outline**:

```ts
// 1. Validate seed
const seed = await heliusWallet({ action: 'getWalletIdentity', address: cobiAddr });
const seedScore = await heliusWallet({ action: 'scoreWallet', address: cobiAddr });
assert(seedScore.score >= 60, 'Seed quality too low');

// 2. Funding source
const funding = await heliusWallet({ action: 'getWalletFundedBy', address: cobiAddr });

// 3. Sibling expansion (only if funding is informative)
const siblings = funding.funderAddress
  ? await findSiblings(funding.funderAddress, { excludeAddress: cobiAddr })
  : [];

// 4. Counterparties
const transfers = await heliusWallet({
  action: 'getWalletTransfers',
  address: cobiAddr,
  limit: 200,
});
const counterparties = aggregateCounterparties(transfers, { minInteractions: 3 });

// 5. Filter and score
const candidates = [...siblings, ...counterparties.map(c => c.address)];
const filtered = await filterCEXAndPrograms(candidates);
const scored = await Promise.all(
  filtered.map(addr => heliusWallet({ action: 'scoreWallet', address: addr }))
);

// 6. Behavioral similarity to seed
const similar = scored.filter(s => Math.abs(s.score - seedScore.score) <= 20);

// 7. Token-overlap clustering
const seedTokens = await topTokens(cobiAddr, 20);
const clusterMembers = await Promise.all(
  similar.map(async s => ({
    ...s,
    tokenOverlap: jaccard(seedTokens, await topTokens(s.address, 20)),
  }))
);

// 8. Present
const tightCluster = clusterMembers.filter(m => m.tokenOverlap >= 0.5);
const looseCluster = clusterMembers.filter(m => m.tokenOverlap >= 0.2 && m.tokenOverlap < 0.5);
```

**Output**: tight cluster (likely same operator or coordinated group), loose cluster (related traders), peripheral counterparties (possible OTC partners).

---

## Pattern 3: Smart-money signal verifier

**Use case**: "I subscribe to OKX smart-money signals — drop the noise."

**Pipeline**:

```
Subscribe: OKX smart-money signal stream (from helius-okx skill)
  → for each signal {wallet, token, side}:
      → scoreWallet(wallet) — drop if < threshold
      → check wallet not in known wash-trade cluster
      → check wallet's token holdings make this trade plausible (not a one-token wallet)
  → surface verified signals to user
```

**Code outline** (signal handler, called once per provider event):

```ts
async function verifyAndForward(signal: ProviderSignal) {
  // 1. Quick score
  const s = await heliusWallet({ action: 'scoreWallet', address: signal.wallet });
  if (s.score < 70) return null; // drop

  // 2. Wash-trade check (cached)
  const cluster = await getCachedCluster(signal.wallet);
  if (cluster?.isWashCluster) return null;

  // 3. Plausibility — does wallet have history with similar tokens?
  const balances = await heliusWallet({
    action: 'getTokenBalances',
    address: signal.wallet,
  });
  const distinctTokens = balances.tokens?.length ?? 0;
  if (distinctTokens < 5) return null; // single-bet wallet — skip

  // 4. Recency — was wallet active in last 24h?
  if (s.components.recency < 80) return null;

  return {
    ...signal,
    walletScore: s.score,
    components: s.components,
    plausibility: 'verified',
  };
}
```

**Output**: 10-30% of provider signals pass (depends on provider quality). What survives is high-confidence.

---

## Pattern 4: Pump.fun early-entry hunter

**Use case**: "Find wallets that are consistently early on pump.fun graduates."

**Pipeline**:

```
For last N pump.fun graduates (last 7 days):
  → token-anchored discovery with early-entry filter (within 1h of launch)
  → collect all early entrants
  → for each entrant, score across full memecoin behavior (not just this token)
  → rank by frequency-of-being-early × score
  → final: wallets that are repeatedly early AND broadly good
```

**Code outline**:

```ts
// 1. Get recent pump.fun graduates (helius-okx skill or pump.fun API)
const graduates = await getPumpFunGraduates({ daysBack: 7, minMarketCap: 100_000 });

// 2. For each graduate, find early entrants
const earlyEntrantsPerToken = await Promise.all(
  graduates.map(g => findEarlyEntrants(g.mint, { withinHours: 1 }))
);

// 3. Aggregate: which wallets show up in multiple lists?
const counts = new Map<string, number>();
for (const list of earlyEntrantsPerToken) {
  for (const addr of list) counts.set(addr, (counts.get(addr) ?? 0) + 1);
}

const candidates = Array.from(counts.entries())
  .filter(([_, n]) => n >= 3) // early on at least 3 graduates
  .map(([addr]) => addr);

// 4. Score across general memecoin behavior
const scored = await Promise.all(
  candidates.map(addr =>
    heliusWallet({ action: 'scoreWallet', address: addr, lookbackDays: 30 })
  )
);

// 5. Combined ranking: early-frequency × score
const ranked = scored
  .map(s => ({ ...s, earlyCount: counts.get(s.address)! }))
  .map(s => ({ ...s, combinedRank: s.earlyCount * s.score }))
  .sort((a, b) => b.combinedRank - a.combinedRank);
```

**Output**: 5-20 wallets that are consistently early on graduates and broadly active. These are sniper-type wallets, often profitable but high-risk.

---

## Pattern 5: Copy-trading bot foundation

**Use case**: "Build the discovery + monitoring layer for a copy-trading bot."

**Pipeline**:

```
1. Build watchlist (Pattern 1, 2, 3, or 4 above)
2. Subscribe to LaserStream for each watchlist address
3. On every transaction:
   → parseTransactions to extract swap details
   → notify the bot's execution layer (which handles trading via helius skill / helius-okx)
4. Re-score watchlist daily; rotate out members whose score drops below threshold
```

This skill is responsible for **building and maintaining the watchlist** (steps 1 + 4). The bot's execution layer (steps 2 + 3) belongs to the canonical `helius` and `helius-okx` skills.

**Watchlist refresh logic**:

```ts
async function refreshWatchlist(currentList: string[]) {
  const scored = await Promise.all(
    currentList.map(addr => heliusWallet({ action: 'scoreWallet', address: addr }))
  );

  // Drop members whose score fell below 60
  const survivors = scored.filter(s => s.score >= 60).map(s => s.address);

  // Drop members whose recency dropped (they went dormant)
  const active = survivors.filter(s =>
    scored.find(x => x.address === s)?.components.recency >= 50
  );

  // Top up to target size via fresh discovery
  const targetSize = 50;
  if (active.length < targetSize) {
    const fresh = await runDiscovery({ count: targetSize - active.length });
    return [...active, ...fresh];
  }

  return active;
}
```

Run daily via cron / webhook trigger.

---

## Anti-patterns

These are workflows that **look reasonable** but produce bad signal. Don't do them.

### ❌ "Score every wallet on Solana"

The candidate set must be filtered to a meaningful pool first (top holders, provider list, seed cluster). Scoring random wallets is expensive and uninformative.

### ❌ "Aggregate provider scores"

Cielo's 70 + Nansen's 70 ≠ "really good wallet." Each provider's score has its own scale and bias. Use them as binary inclusion signals; rank with Helius.

### ❌ "Rank by a single component"

A wallet with `volume = 100` but `recency = 0` and `diversification = 5` is a former-active whale, not smart money. Always use composite or surface all components.

### ❌ "Auto-execute on signal"

This skill is a discovery skill, not a trading skill. Always require user confirmation for actual trades.

### ❌ "Republish wallet rankings"

Surfacing ranked wallets in a public product can dox individuals. Always confirm consent or anonymize before any external publication.
