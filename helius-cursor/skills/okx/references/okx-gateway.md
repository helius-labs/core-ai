# OKX Gateway & Portfolio — Transaction Infrastructure & Wallet Balances

## What This Covers

Two capabilities:
1. **Gateway**: Transaction infrastructure — gas/priority fee estimation, transaction simulation, broadcasting pre-signed transactions, and order tracking
2. **Portfolio**: Multi-chain wallet balance queries with risk filtering

All commands use the `onchainos` CLI binary.

**Important**: For most Solana transactions, prefer **Helius Sender** over OKX Gateway for broadcasting. Sender dual-routes to validators AND Jito for maximum block inclusion probability. Use OKX Gateway when you need transaction simulation or when working with cross-chain workflows.

---

## Gateway Commands

### List Supported Chains

```bash
onchainos gateway chains
```

Returns 20+ supported chains with their details.

### Gas / Priority Fee Estimation

```bash
onchainos gateway gas --chain solana
```

**Solana-specific return fields:**
- `proposePriorityFee`: Standard priority fee
- `safePriorityFee`: Safe priority fee
- `fastPriorityFee`: Fast priority fee
- `extremePriorityFee`: Extreme priority fee

Note: For Solana priority fees, prefer Helius `getPriorityFeeEstimate` MCP tool — it provides program-specific estimates based on recent slot data. See `references/helius-priority-fees.md`.

### Gas Limit Estimation

```bash
onchainos gateway gas-limit \
  --from <SENDER_ADDRESS> \
  --to <RECIPIENT_ADDRESS> \
  --chain solana
```

Estimates gas/compute units for a transaction.

### Transaction Simulation

```bash
onchainos gateway simulate \
  --from <SENDER_ADDRESS> \
  --to <PROGRAM_ADDRESS> \
  --data <HEX_DATA> \
  --chain solana
```

**Returns:**
- `intention`: Human-readable description of what the transaction does
- `assetChange[]`: List of token/SOL balance changes per address
- `gasUsed`: Actual compute units consumed
- `failReason`: If simulation fails, the reason why
- `risks[]`: Identified risks or warnings

**Use cases:**
- Preview what a transaction will do before signing
- Verify expected token transfers and amounts
- Detect potential failures before broadcasting
- Check for risks (e.g., drainer contracts, unexpected transfers)

### Broadcast Transaction

```bash
onchainos gateway broadcast \
  --signed-tx <BASE58_SIGNED_TX> \
  --address <SENDER_ADDRESS> \
  --chain solana
```

**Solana-specific:** Signed transactions MUST be **base58** encoded (not hex like EVM chains).

**Returns:**
- `orderId`: Tracking ID for the order
- `txHash`: Transaction signature

**Important**: The gateway does NOT sign transactions — it only broadcasts pre-signed ones. The user must sign locally.

**For most Solana use cases, prefer Helius Sender** (`references/helius-sender.md`). Use OKX Gateway when:
- You need the `simulate` step first
- You're building cross-chain workflows
- You need the `orderId` tracking system

### Track Order Status

```bash
onchainos gateway orders --address <SENDER_ADDRESS> --chain solana
```

**Returns per order:**
- `txStatus`: `1` = Pending, `2` = Success, `3` = Failed
- `orderId`, `txHash`, timestamp, and other metadata

---

## Portfolio Commands

### List Supported Chains

```bash
onchainos portfolio chains
```

Returns all supported chains for balance queries. Different from PnL-supported chains.

### Total Portfolio Value

```bash
onchainos portfolio total-value \
  --address <WALLET_ADDRESS> \
  --chains solana \
  --asset-type 0
```

**Parameters:**
- `--address` (required): Wallet address
- `--chains` (required): Comma-separated chain names or IDs (max 50)
- `--asset-type` (optional, default `"0"`): `0` = all assets, `1` = tokens only, `2` = DeFi positions only
- `--exclude-risk` (optional, default `true`): Filter risky/scam tokens (works on ETH, BSC, SOL, BASE)

Returns: `totalValue` in USD.

### All Token Balances

```bash
onchainos portfolio all-balances \
  --address <WALLET_ADDRESS> \
  --chains solana
```

**Parameters:**
- `--address` (required)
- `--chains` (required): Comma-separated, max 50 chains
- `--exclude-risk` (optional, default `"0"`): `0` = filter risky, `1` = include all

**Returns `tokenAssets[]`** per token:
- `chainIndex`, `tokenContractAddress`, `symbol`
- `balance`: Human-readable units (e.g., "1.5" SOL)
- `rawBalance`: Atomic units (e.g., "1500000000" lamports)
- `tokenPrice`: USD price per token
- `isRiskToken`: Boolean risk flag

### Specific Token Balances

```bash
onchainos portfolio token-balances \
  --address <WALLET_ADDRESS> \
  --tokens "501:EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v,501:"
```

**Parameters:**
- `--address` (required)
- `--tokens` (required): `chainIndex:tokenAddress` pairs, comma-separated (max 20). Use empty address for native token (e.g., `"501:"` for native SOL)

Returns same `tokenAssets[]` schema as `all-balances`.

---

## Choosing Between OKX Portfolio and Helius Wallet API

| Feature | OKX Portfolio | Helius Wallet API |
|---------|--------------|-------------------|
| Multi-chain | Yes (50+ chains) | Solana only |
| USD pricing | Yes | Yes (top 10K tokens, hourly) |
| Risk filtering | Yes (SOL, ETH, BSC, BASE) | No |
| NFT support | No | Yes (`showNfts`) |
| Identity resolution | No | Yes (Orb-powered) |
| Funding source | No | Yes (`getWalletFundedBy`) |
| Transaction history | No | Yes (`getWalletHistory`) |
| Credits | Uses OKX API | 100 credits/request |

**Use OKX Portfolio when**: You need multi-chain balances or risk-filtered token lists.
**Use Helius Wallet API when**: You need Solana-specific intelligence — identity, funding source, transaction history, or NFTs. See `references/helius-wallet-api.md`.

---

## Cross-Chain Portfolio View

For a comprehensive portfolio that includes Solana and other chains:

1. **Solana holdings**: Use Helius `getWalletBalances` for detailed Solana data with identity enrichment
2. **Other chains**: Use `onchainos portfolio all-balances --chains ethereum,base,bsc` for EVM chains
3. **Total value**: Use `onchainos portfolio total-value --chains solana,ethereum,base` for aggregate USD value

---

## Safety Notes

- OKX Gateway does NOT sign transactions — signing must happen locally
- Solana signed transactions use base58 encoding (not hex)
- Always simulate transactions before broadcasting when possible
- Check `risks[]` in simulation results for drainer contracts or suspicious transfers
- `isRiskToken` flag only works on ETH, BSC, SOL, and BASE — tokens on other chains are unfiltered
- EVM addresses cannot query Solana chains and vice versa — separate API calls required

## Common Mistakes

- Broadcasting via OKX Gateway when Helius Sender would give better inclusion rates on Solana
- Using hex encoding for Solana transactions (must be base58)
- Mixing EVM and Solana addresses in the same portfolio query
- Not checking simulation `failReason` before broadcasting
- Forgetting that `--exclude-risk` defaults differ between `total-value` (true) and `all-balances` ("0" = filter)
- Using `total-value` for detailed balances (it only returns a single USD figure)
