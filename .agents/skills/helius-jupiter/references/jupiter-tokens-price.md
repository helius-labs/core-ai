# Jupiter Tokens & Price APIs

## What This Covers

Token discovery, metadata, and pricing via Jupiter's Tokens and Price APIs — searching for tokens, verifying legitimacy, and getting real-time prices.

---

## Tokens API

### Base URL & Auth

```
Base: https://api.jup.ag/tokens/v1
Auth: x-api-key header (required)
```

### GET /search — Search Tokens

Search for tokens by name, symbol, or mint address:

```typescript
const response = await fetch(
  `https://api.jup.ag/tokens/v1/search?query=bonk`,
  { headers: { 'x-api-key': process.env.JUPITER_API_KEY! } }
);

const tokens = await response.json();
// Returns array of matching tokens with metadata
```

Each token result includes:
- `address` — Mint address
- `name` — Token name
- `symbol` — Token symbol
- `decimals` — Decimal places
- `logoURI` — Token logo URL
- `tags` — Verification tags (e.g., `verified`, `community`)
- `daily_volume` — 24h trading volume

### Token Verification & Organic Score

Jupiter assigns tokens an **organic score** based on trading activity and community validation. Use this to filter out low-quality or potentially malicious tokens:

```typescript
// Filter for verified tokens only
const verifiedTokens = tokens.filter(
  t => t.tags?.includes('verified') || t.tags?.includes('community')
);
```

**Best practice**: Always verify tokens before displaying them in a UI. Show verification status to users.

### GET /token/{mint} — Get Token by Mint

```typescript
const response = await fetch(
  `https://api.jup.ag/tokens/v1/token/${mintAddress}`,
  { headers: { 'x-api-key': process.env.JUPITER_API_KEY! } }
);

const token = await response.json();
```

---

## Price API

### Base URL & Auth

```
Base: https://api.jup.ag/price/v2
Auth: x-api-key header (required)
```

### GET /price — Get Token Prices

```typescript
const mints = [
  'So11111111111111111111111111111111111111112', // SOL
  'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
].join(',');

const response = await fetch(
  `https://api.jup.ag/price/v2?ids=${mints}`,
  { headers: { 'x-api-key': process.env.JUPITER_API_KEY! } }
);

const prices = await response.json();
// Returns: { data: { [mintAddress]: { id, price, ... } } }
```

**Constraints**:
- Maximum **50 mint IDs** per request
- Prices are in USD

### Price Confidence Levels

The Price API returns confidence metadata. Use this to determine data quality:

```typescript
const solPrice = prices.data['So11111111111111111111111111111111111111112'];
console.log(`SOL: $${solPrice.price}`);
// Check confidence before displaying
```

---

## Token Shield — Security Checks

Jupiter provides a security check endpoint to detect potentially dangerous tokens.

### GET /ultra/v1/shield — Check Token Safety

```typescript
const response = await fetch(
  `https://api.jup.ag/ultra/v1/shield?inputMint=${mintAddress}`,
  { headers: { 'x-api-key': process.env.JUPITER_API_KEY! } }
);

const shield = await response.json();
// Returns warnings about: freeze authority, mint authority, low organic activity, etc.
```

### Helius Synergy

Combine Token Shield with Helius DAS for comprehensive token safety:

```typescript
// 1. Jupiter Token Shield — check for freeze/mint authority risks
const shieldData = await checkTokenShield(mintAddress);

// 2. Helius DAS — check token metadata, supply, and holder distribution
// Use getAsset MCP tool for metadata
// Use getTokenHolders MCP tool for holder concentration
// High holder concentration + freeze authority = high risk
```

**Best practice**: Always run Token Shield before displaying unknown tokens in a swap UI. Show warnings to users.

---

## Building a Token Selector

Combine Jupiter Tokens API with Helius DAS for a complete token selector:

```typescript
// 1. Get user's token holdings via Helius
// Use getAssetsByOwner MCP tool with showFungible: true

// 2. Enrich with Jupiter metadata
// For each holding, fetch token info from Jupiter Tokens API

// 3. Get live prices
// Batch mint addresses into Price API calls (max 50 per request)

// 4. Display with verification status
// Show verified badge, price, and balance
```

See `references/integration-patterns.md` Pattern 2 for the complete implementation.

---

## Common Pitfalls

1. **Max 50 mints per price request** — Batch larger lists into multiple calls
2. **Verify tokens before displaying** — Check tags and organic score to filter scam tokens
3. **Prices are in USD** — No need to convert
4. **Use Helius DAS for ownership data** — Jupiter Tokens API provides metadata, not wallet-specific data

---

## Resources

- Tokens API Docs: [dev.jup.ag/docs/tokens](https://dev.jup.ag/docs/tokens)
- Price API Docs: [dev.jup.ag/docs/price](https://dev.jup.ag/docs/price)
