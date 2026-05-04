# Token-Anchored Discovery

Find good wallets by anchoring on a token the user names. The user knows what they're interested in (a specific memecoin, AI token, a launch they missed); the goal is to surface the wallets that profited.

## When to use

- "Who got rich on $WIF?"
- "Find wallets that bought $TRUMP early"
- "Top traders on this pump.fun token"
- "Who's buying AI tokens this week"

## Pipeline

```
1. Resolve token mint     ← user input or DAS lookup
2. Get top holders        ← getTokenHolders(mint, limit=100)
3. Filter holders         ← drop CEX/router/contract addresses
4. Pull transaction signatures ← getSignaturesForAsset(mint) for the asset
5. For each holder:
   - getWalletHistory(address, limit=30)
   - score realized P&L on this token
6. Rank by P&L, surface top N
7. Enrich top N           ← batchWalletIdentity, getWalletBalances
```

## Step-by-step

### Step 1: Resolve the token

If the user gives you a ticker or name (not a mint), resolve it:

```ts
// MCP
const asset = await heliusAsset({ action: "searchAssets", name: "WIF" });
// or via DEX provider (helius-okx skill)
```

### Step 2: Get top holders

```ts
heliusAsset({
  action: "getTokenHolders",
  mint: "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm", // $WIF
  limit: 100
})
```

Returns top 100 holders by balance. **This is the candidate pool**, not the answer — many will be CEX hot wallets, market makers, or bridge contracts.

### Step 3: Filter junk

Reject candidates that match:

| Pattern | Why |
|---------|-----|
| Known CEX deposit address | Coinbase, Binance, Kraken — labels via `batchWalletIdentity` |
| Token program account (PDA) | Not a wallet — usually a vault, AMM pool, or escrow |
| < 100 transaction history | Either brand-new or single-purpose |
| > 95% of activity is one program | Bots, MMs, arbitrage — not "trader" smart money |
| `programOwner` is set | Smart contract, not a user wallet |

Use `batchWalletIdentity` for labels:

```ts
heliusWallet({
  action: "batchWalletIdentity",
  addresses: [...top100]
})
// returns labels, domains, exchange identifiers per address
```

Drop addresses with `exchange`, `bridge`, `program`, or `system` labels.

### Step 4: Pull token-specific tx history

For each remaining candidate, you want their trades **on this specific token**, not all activity. Use `getSignaturesForAsset` to get every signature involving the mint, then intersect with the wallet's signatures:

```ts
// All signatures touching this mint
const mintSigs = await heliusAsset({
  action: "getSignaturesForAsset",
  id: mint,
  limit: 1000
});

// Per-wallet history
const walletSigs = await heliusWallet({
  action: "getWalletHistory",
  address: walletAddr,
  limit: 100
});

// Intersect: signatures the wallet was in AND that touched this mint
const tokenTxs = walletSigs.filter(s => mintSigs.includes(s.signature));
```

Or, if the wallet has < 1000 lifetime txs, just `parseTransactions` on the intersection set and look at SWAP / TRANSFER events involving the mint.

### Step 5: Score realized P&L on this token

For each wallet, compute on this token only:

- **Realized P&L** = (sum of USD value sold) − (sum of USD value bought) for closed positions
- **Unrealized** = (current holding × current price) − (cost basis of remaining holding)
- **Entry slot** = first slot where this wallet acquired the token
- **Hold time** = current slot − entry slot

Use parsed transactions:

```ts
heliusTransaction({
  action: "parseTransactions",
  signatures: tokenTxs
})
// returns events including SWAP with input/output amounts and tokens
```

Aggregate by direction (token in vs out) for each transaction, valued at execution-time price (use Jupiter price feed or OKX market data for historical prices).

### Step 6: Rank

Default ranking: realized P&L descending. Alternative criteria the user may want:

- **Realized P&L %** — for capital-efficient picks (small wallets that 100x'd)
- **Earliest entry** — slot ascending, for "who got in first"
- **Hold-through-pump** — wallets that held during a 5x but didn't sell at the top still count if they're up
- **Recent buys at dip** — entered after a -20% drawdown

### Step 7: Enrich top N

Once you have your top 10-20:

```ts
// Identity
const identities = await heliusWallet({
  action: "batchWalletIdentity",
  addresses: topWallets
});

// Current holdings
for (const w of topWallets) {
  const balances = await heliusWallet({
    action: "getWalletBalances",
    address: w
  });
  // surface: total USD value, top 5 positions, % in this token
}

// Funding source — were they given the bag, or did they earn it?
for (const w of topWallets) {
  const funder = await heliusWallet({
    action: "getWalletFundedBy",
    address: w
  });
}
```

If `getWalletFundedBy` shows the wallet was funded by the token's deployer, that's an **insider**, not a trader — flag accordingly.

## Early-entry filter

For "who bought $TOKEN in the first hour" specifically:

1. Get token launch slot: `getAsset(mint).first_signature_slot` or query `getSignaturesForAsset` and take the earliest signature
2. Convert slot → unix time (~400ms/slot)
3. Cutoff = launch_time + 3600s
4. For each top holder, find their first acquisition signature; keep only those where `slot < cutoff`

These are the **early buyers**, often a mix of insiders (drop) and snipers (good or bad depending on context).

## Pump.fun specialization

Pump.fun launches have 3 phases: bonding curve, graduation to Raydium, post-graduation trading. "Smart money" on pump.fun usually means:

- **Phase 1 snipers**: bought from bonding curve in first 60 seconds → high reward, high rug risk
- **Phase 2 confirmers**: bought after graduation but before first 5x → patient, moderate reward
- **Phase 3 followers**: bought during pump after social signal → late, often unprofitable

Filter by acquisition slot relative to the graduation transaction (look for the migration tx pattern in `parseTransactions`). For deeper pump.fun analysis (dev reputation, bundle detection), defer to the `helius-okx` skill.

## Rate limit and credit budget

Cost estimate for 100-candidate token-anchored discovery:

| Step | Calls | Credits | Notes |
|------|-------|---------|-------|
| getTokenHolders × 1 | 1 | ~20 | Returns 100 holders |
| batchWalletIdentity × 1 | 1 | ~20 | Batch of 100 |
| getWalletHistory × 100 | 100 | ~10000 (100/each) | Filter to candidates first |
| parseTransactions × ~30 | 30 | ~3000 | Top-30 candidates only |
| getWalletBalances × 10 | 10 | ~1000 | Final enrichment |
| **Total** | ~140 | ~14k | Roughly |

For Free plan (~100 credits/sec), this is ~3 minutes wall time. Developer plan or higher recommended for interactive use.

## Common pitfalls

- **"Smart money on $POPCAT" returns the deployer's wallet at #1.** That's not smart money — that's the dev. Always check funding source.
- **Top holders ≠ top traders.** The largest balance might be a dormant whale; the most active profitable wallet might hold only 5% of the supply but trade it weekly.
- **Pump.fun snipers look amazing on one token, terrible across the portfolio.** Always cross-check with `behavioral-scoring.md` over a 30-day window before promoting them to a watchlist.
- **CEX hot wallets show up everywhere.** Filter early — they pollute every ranking.
