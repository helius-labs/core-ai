# Seed-Anchored Discovery

Find good wallets by starting from one wallet the user already trusts, then expanding outward via fund-flow graphs and behavioral similarity.

## When to use

- "@cobie's wallet is good — find more like it"
- "Find the trader cluster around this address"
- "Who else does this market maker fund?"
- "Find dev wallets / team-funded wallets"
- "Who funded this insider before launch?"

## Pipeline

```
1. Start with seed wallet           ← user-provided
2. Find seed's funding source       ← getWalletFundedBy(seed)
3. Find siblings of seed            ← reverse-traverse from funding source
4. Find seed's transfer counterparties ← getWalletTransfers(seed)
5. Filter candidates                 ← drop CEX/programs, dedupe
6. Score each candidate              ← behavioral-scoring
7. Rank, enrich, surface top N
```

The key insight: **wallets that share a funding source often share a strategy**. The funder might be a fund's central treasury, a market maker's distribution wallet, or a single trader's keypair vault.

## Step-by-step

### Step 1: Seed validation

Confirm the seed is actually a useful starting point:

```ts
heliusWallet({ action: "getWalletIdentity", address: seedAddr })
heliusWallet({ action: "getWalletBalances", address: seedAddr })
heliusWallet({ action: "scoreWallet", address: seedAddr })
```

If the seed is a CEX, a program, or scores < 50, fail fast — seed-anchored expansion from a bad seed produces bad clusters.

### Step 2: Funding source (upstream)

```ts
const funder = await heliusWallet({
  action: "getWalletFundedBy",
  address: seedAddr
});
// returns: { funderAddress, fundingTransactions, totalFundedUsd, ... }
```

This is the wallet that originally funded `seedAddr`. There are three common shapes:

| Funder shape | What it usually means |
|--------------|----------------------|
| CEX deposit address (Binance, Coinbase) | Personal user — funder is uninformative |
| Single SOL wallet, large balance | Fund treasury, multi-sig, or whale's vault |
| Token program / vesting contract | Team/insider allocation |
| Bridge contract (Wormhole, etc.) | Cross-chain user |
| Another high-score wallet | Trader operating multiple sub-wallets |

The fund-treasury and trader-multi-wallet cases are where seed-anchored discovery shines.

### Step 3: Sibling expansion (reverse traversal)

If the funder is informative (not a CEX), find every wallet the funder has also funded:

There's no single MCP action for "wallets funded by X" today, so reconstruct:

```ts
// Get the funder's outgoing transfers
const transfers = await heliusWallet({
  action: "getWalletTransfers",
  address: funder.funderAddress,
  direction: "out",
  limit: 200
});

// Recipients that received SOL or USDC, large enough to be a wallet seed
const candidateSiblings = transfers
  .filter(t => ["SOL", "USDC"].includes(t.token))
  .filter(t => t.amountUsd >= 50)  // funding-tier transfers
  .map(t => t.toAddress);
```

Dedupe and remove the original seed. These are **fund siblings**.

### Step 4: Transfer counterparties (lateral)

The seed wallet also reveals related parties through who it transacts with regularly:

```ts
const transfers = await heliusWallet({
  action: "getWalletTransfers",
  address: seedAddr,
  limit: 200
});

const counterparties = aggregateByCounterparty(transfers);
// keep only counterparties with > 3 distinct transactions
```

Frequent counterparties might be:

- Trading partners or co-investors
- The user's other wallets
- A KOL group's chat-coordinated wallets
- Toxic liquidity providers

### Step 5: Filter

For both sibling and counterparty sets, drop:

- CEX deposit addresses (`batchWalletIdentity` → exchange label)
- Program accounts
- The seed itself, the funder itself
- Wallets with < 30 days of history (likely fresh)

### Step 6: Behavioral score

For each remaining candidate, run the score (see `behavioral-scoring.md`):

```ts
const scored = await Promise.all(
  candidates.map(addr =>
    heliusWallet({ action: "scoreWallet", address: addr, lookbackDays: 30 })
  )
);
```

Compare each candidate's score to the seed's score. The cluster you want is **siblings whose score is within 20 points of the seed** — that's the "actually similar" set.

### Step 7: Rank and enrich

Sort by score descending. For the top N:

```ts
heliusWallet({ action: "batchWalletIdentity", addresses: topN })
heliusWallet({ action: "getWalletBalances", address: w })  // per-wallet
```

Show the user:

- The seed and its score
- The funder and its identity (if known)
- Top N similar wallets, each with score, top holdings, and a label-based description ("trader cluster member, 32 trades / 30d, 67% win rate")

## Specializations

### Treasury seed

When the user gives you a known treasury (DAO multisig, fund treasury), seed-anchored expansion finds the **operating wallets** that treasury delegates capital to:

```
Treasury (seed)
  → outgoing transfers > $1k
  → recipient = candidate operator
  → score each candidate
  → rank by score
```

This finds fund traders, OTC counterparties, and grant recipients.

### Insider/team seed

When the seed is a token deployer or team-allocation vesting contract:

```
Team contract (seed)
  → outgoing transfers (token + SOL)
  → recipients that sold the token after receiving = sellers
  → recipients that held long-term = holders
```

This identifies which insiders dumped vs held — actionable signal for any future launches by the same team.

### KOL/individual seed

When the user names a known person's wallet, the most useful expansion is **alt-wallets they operate**:

```
KOL (seed)
  → SOL transfers > 5 SOL with same destination repeatedly = funding pattern
  → counterparties that share a CEX deposit address
  → wallets funded within 1 hour of seed funding events (coordinated)
```

Always be careful here: **a counterparty is not necessarily the same person**. Don't dox.

## Cluster scoring

Once you have a candidate set of N wallets, compute a **cluster coherence** signal:

- Do they trade the same tokens within a short time window? Use `getWalletHistory` and compute Jaccard similarity of their token positions.
- Do they enter on the same blocks or within a 30-second window? Coordinated cluster.
- Do they exit in the same window? Either coordinated or all reading the same chart.

High coherence is interesting — it might be a fund, a chat group, or a bot fleet. **Coordinated activity ≠ smart money**, but it IS a tradeable signal.

## Cost estimate

| Step | Calls | Credits | Notes |
|------|-------|---------|-------|
| getWalletIdentity (seed) | 1 | 100 | |
| scoreWallet (seed) | 1 | ~500 | composite of multiple primitives |
| getWalletFundedBy | 1 | 100 | |
| getWalletTransfers (funder, seed) | 2 | 200 | |
| batchWalletIdentity | 1 | ~30 | |
| scoreWallet × ~30 | 30 | ~15000 | Most expensive step |
| getWalletBalances × 10 | 10 | ~1000 | Final enrichment |
| **Total** | ~46 | ~17k | Roughly |

## Common pitfalls

- **The funder is often a CEX.** Don't waste credits expanding from Binance hot wallet — every other wallet on Solana has touched it.
- **Counterparty ≠ collaborator.** A wallet that sent the seed 10 SOL once is not necessarily related; require ≥ 3 distinct interactions.
- **Coordinated clusters are not always smart.** A fleet of bots running the same strategy will show high coherence but might lose money in aggregate. Always cross-check with behavioral score.
- **Doxxing risk.** `batchWalletIdentity` returns SNS/ANS domains and known labels. If the seed is a public figure and the cluster has unlabeled siblings, do NOT publish — those might be the public figure's anonymous alts.
- **A seed that is itself bad will produce a bad cluster.** Always score the seed before expanding.
