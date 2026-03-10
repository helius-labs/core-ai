# Integration Patterns — Helius x Jupiter

## What This Covers

End-to-end patterns for combining Jupiter APIs with Helius infrastructure. These patterns show how the two systems connect at the transaction, data, and monitoring layers.

**Jupiter** handles DeFi operations — token swaps (Ultra), lending/borrowing (Lend), limit orders (Trigger), DCA (Recurring), and token/price data.

**Helius** handles infrastructure — transaction submission (Sender), fee optimization (Priority Fees), token/NFT data (DAS), real-time on-chain monitoring (WebSockets), shred-level streaming (LaserStream), and wallet intelligence (Wallet API).

---

## Pattern 1: Jupiter Swap via Helius Sender

The most common integration. Jupiter Ultra provides the swap transaction; Helius Sender submits it for optimal block inclusion.

### Flow

1. Get a quote from Jupiter `/ultra/v1/order`
2. Deserialize the returned base64 transaction
3. Sign the transaction
4. Submit via Helius Sender endpoint
5. Confirm the transaction

### TypeScript Example

```typescript
import { VersionedTransaction, Keypair } from '@solana/web3.js';

const JUPITER_API = 'https://api.jup.ag';
const SENDER_URL = `https://sender.helius-rpc.com/fast?api-key=${process.env.HELIUS_API_KEY}`;

async function swapViaJupiterAndSender(
  keypair: Keypair,
  inputMint: string,
  outputMint: string,
  amount: string,
): Promise<string> {
  // 1. Get quote and transaction from Jupiter
  const params = new URLSearchParams({
    inputMint,
    outputMint,
    amount,
    taker: keypair.publicKey.toBase58(),
  });

  const orderRes = await fetch(`${JUPITER_API}/ultra/v1/order?${params}`, {
    headers: { 'x-api-key': process.env.JUPITER_API_KEY! },
  });
  const order = await orderRes.json();

  if (order.error) throw new Error(`Jupiter error: ${order.error}`);

  // 2. Deserialize and sign
  const txBuffer = Buffer.from(order.transaction, 'base64');
  const transaction = VersionedTransaction.deserialize(txBuffer);
  transaction.sign([keypair]);

  // 3. Submit via Helius Sender
  const sendRes = await fetch(SENDER_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: Date.now().toString(),
      method: 'sendTransaction',
      params: [
        Buffer.from(transaction.serialize()).toString('base64'),
        { encoding: 'base64', skipPreflight: true, maxRetries: 0 },
      ],
    }),
  });

  const sendResult = await sendRes.json();
  if (sendResult.error) throw new Error(`Sender error: ${sendResult.error.message}`);

  return sendResult.result; // transaction signature
}
```

### When to Use Jupiter Execute vs Helius Sender

- **Jupiter `/execute`**: Simpler — handles submission for you, includes `requestId` idempotency. Best for most use cases.
- **Helius Sender**: More control — you submit directly with Jito bundles and SWQoS. Best when you need custom priority fees or are already using Helius Sender for other transactions.

---

## Pattern 2: Token Selector with DAS + Jupiter

Build a swap UI token selector combining user holdings from Helius with Jupiter metadata and prices.

### Flow

1. Fetch user's token holdings via Helius DAS (`getAssetsByOwner`)
2. Enrich with Jupiter token metadata (verification, logos)
3. Get live prices from Jupiter Price API
4. Display sorted by value with verification badges

### TypeScript Example

```typescript
// Step 1: Get user holdings via Helius MCP
// Use getAssetsByOwner with showFungible: true
// Returns: array of assets with mint, amount, decimals

// Step 2: Enrich with Jupiter metadata
const mintAddresses = holdings.map(h => h.mint);

// Step 3: Batch price lookup (max 50 per request)
const chunks = [];
for (let i = 0; i < mintAddresses.length; i += 50) {
  chunks.push(mintAddresses.slice(i, i + 50));
}

const allPrices: Record<string, number> = {};
for (const chunk of chunks) {
  const res = await fetch(
    `https://api.jup.ag/price/v2?ids=${chunk.join(',')}`,
    { headers: { 'x-api-key': process.env.JUPITER_API_KEY! } }
  );
  const data = await res.json();
  for (const [mint, info] of Object.entries(data.data)) {
    allPrices[mint] = (info as any).price;
  }
}

// Step 4: Combine and sort by USD value
const enrichedHoldings = holdings.map(h => ({
  ...h,
  price: allPrices[h.mint] || 0,
  usdValue: (h.amount / Math.pow(10, h.decimals)) * (allPrices[h.mint] || 0),
})).sort((a, b) => b.usdValue - a.usdValue);
```

---

## Pattern 3: Lending Position with Helius Monitoring

Deposit tokens into Jupiter Lend and monitor the position with Helius WebSockets.

### Flow

1. Query vault data via Jupiter Lend read SDK
2. Build deposit transaction via write SDK
3. Submit via Helius Sender
4. Monitor position changes via Helius WebSockets

### TypeScript Example

```typescript
import { Client } from "@jup-ag/lend-read";
import { getOperateIx } from "@jup-ag/lend/borrow";
import BN from "bn.js";

// 1. Query vault data
const connection = new Connection(HELIUS_RPC_URL);
const client = new Client(connection);
const vaultData = await client.vault.getVaultByVaultId(targetVaultId);

// Check limits before proceeding
if (depositAmount > vaultData.limitsAndAvailability.supplyLimit) {
  throw new Error('Deposit exceeds vault supply limit');
}

// 2. Build deposit transaction
const { ixs, addressLookupTableAccounts, positionId } = await getOperateIx({
  vaultId: targetVaultId,
  positionId: 0, // new position
  colAmount: new BN(depositAmount),
  debtAmount: new BN(0),
  connection,
  signer: userPublicKey,
});

// 3. Build, sign, submit via Helius Sender
// (See Pattern 1 for Sender submission code)

// 4. Monitor position via Helius WebSockets
// Use accountSubscribe MCP tool to watch the position account
// Trigger alerts when LTV approaches liquidation threshold
```

---

## Pattern 4: Limit Order + DCA with Status Tracking

Set up limit orders and DCA orders, then track their execution status.

### Flow

1. Create orders via Jupiter Trigger/Recurring APIs
2. Submit order transactions via Helius Sender
3. Use Helius `parseTransactions` to get human-readable execution history
4. Use Helius WebSockets to get real-time notifications when orders fill

```typescript
// 1. Create a limit order
const orderRes = await fetch('https://api.jup.ag/trigger/v1/order', {
  method: 'POST',
  headers: {
    'x-api-key': process.env.JUPITER_API_KEY!,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    maker: walletPublicKey,
    inputMint: SOL_MINT,
    outputMint: USDC_MINT,
    makingAmount: '1000000000', // 1 SOL
    takingAmount: '200000000',  // Min 200 USDC (limit price)
    expiredAt: null,
  }),
});

// 2. Sign and submit via Helius Sender
// ...

// 3. Check order execution history via Helius
// Use parseTransactions MCP tool with the wallet address
// Jupiter order fills show as "SWAP" transaction types
```

---

## Pattern 5: Portfolio Dashboard with DeFi Positions

Build a comprehensive dashboard showing token holdings, lending positions, and open orders.

### Architecture

```
Helius Wallet API  →  Token holdings + USD values
Helius DAS API     →  Token metadata + NFT positions
Jupiter Lend Read  →  Lending positions + yield data
Jupiter Trigger    →  Open limit orders
Jupiter Recurring  →  Active DCA orders
Jupiter Price API  →  Live price feeds
```

### Data Flow

```typescript
// Parallel data fetching for dashboard
const [walletBalances, lendPositions, limitOrders, dcaOrders] = await Promise.all([
  // Helius: wallet holdings
  heliusWalletBalances(walletAddress),
  // Jupiter Lend: vault positions
  lendClient.vault.positionsByUser(walletPublicKey),
  // Jupiter Trigger: open limit orders
  fetch(`https://api.jup.ag/trigger/v1/orders?wallet=${walletAddress}`, {
    headers: { 'x-api-key': JUPITER_API_KEY },
  }).then(r => r.json()),
  // Jupiter Recurring: active DCA orders
  fetch(`https://api.jup.ag/recurring/v1/orders?wallet=${walletAddress}`, {
    headers: { 'x-api-key': JUPITER_API_KEY },
  }).then(r => r.json()),
]);
```

---

## Pattern 6: Trading Bot with LaserStream

Build a high-speed trading bot using LaserStream for market data and Jupiter Ultra for execution.

### Architecture

```
LaserStream (gRPC)  →  Shred-level on-chain data (price changes, liquidity shifts)
Jupiter Ultra API   →  Swap execution with optimized routing
Helius Sender       →  Transaction submission with Jito bundles
```

### Flow

1. Subscribe to relevant accounts via LaserStream
2. Detect trading opportunity (price divergence, arbitrage, etc.)
3. Get quote from Jupiter Ultra
4. Sign and submit via Helius Sender
5. Monitor confirmation via LaserStream

```typescript
import { subscribe } from 'helius-laserstream';

// 1. Subscribe to pool accounts for price monitoring
const stream = subscribe({
  apiKey: process.env.HELIUS_API_KEY!,
  endpoint: 'mainnet', // or regional endpoint for lower latency
  commitment: 'confirmed',
  accounts: [POOL_ACCOUNT_ADDRESS],
});

stream.on('data', async (update) => {
  // 2. Detect opportunity
  const opportunity = analyzeUpdate(update);
  if (!opportunity) return;

  // 3. Execute swap via Jupiter
  const signature = await swapViaJupiterAndSender(
    keypair,
    opportunity.inputMint,
    opportunity.outputMint,
    opportunity.amount,
  );

  console.log(`Trade executed: ${signature}`);
});
```

### Latency Considerations

- Choose the **closest LaserStream regional endpoint** to your server
- Use `CONFIRMED` commitment (faster than `FINALIZED`)
- Pre-build transactions where possible to minimize execution time
- LaserStream requires **Professional plan** ($999/mo) on mainnet

---

## Pattern 7: Jupiter Plugin with Helius Portfolio

The fastest path to adding swap functionality — use Jupiter's drop-in widget with Helius for portfolio context.

### Flow

1. Fetch user's token holdings via Helius DAS
2. Display portfolio in your app
3. Initialize Jupiter Plugin with Helius RPC
4. Let users click tokens to pre-fill swap parameters
5. Monitor completed swaps via Helius parseTransactions

### TypeScript Example (React)

```typescript
import { JupiterTerminal } from '@jup-ag/terminal';
import '@jup-ag/terminal/css';

function SwapPage({ walletAddress }: { walletAddress: string }) {
  const [selectedMint, setSelectedMint] = useState<string | null>(null);
  const [holdings, setHoldings] = useState([]);

  useEffect(() => {
    // Fetch holdings via Helius (getAssetsByOwner MCP tool)
    fetchHoldings(walletAddress).then(setHoldings);
  }, [walletAddress]);

  return (
    <div>
      {/* Portfolio list — click to swap */}
      <div>
        {holdings.map(token => (
          <div key={token.mint} onClick={() => setSelectedMint(token.mint)}>
            {token.symbol}: {token.balance} (${token.usdValue})
          </div>
        ))}
      </div>

      {/* Jupiter swap widget */}
      <JupiterTerminal
        displayMode="integrated"
        endpoint={`https://mainnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}`}
        defaultExplorer="Orb"
        formProps={selectedMint ? { initialInputMint: selectedMint } : undefined}
      />
    </div>
  );
}
```

### Helius Value

- **Helius RPC** powers the plugin's transaction submission
- **DAS API** provides the portfolio context surrounding the swap
- **parseTransactions** gives rich post-swap transaction details
- **Wallet API** keeps the portfolio view updated after swaps

---

## Cross-Pattern Best Practices

1. **Always use Helius RPC** for Jupiter Lend SDK connections — provides reliable, high-performance access
2. **Batch API calls** — Jupiter Price API (max 50 per request), Helius DAS batch endpoints
3. **Handle errors at each layer** — Jupiter API errors, Sender errors, and on-chain errors are different
4. **Use environment variables** for all API keys — never hardcode
5. **Log with context** — Include requestId, signature, and timestamps for debugging
6. **Respect rate limits** — Jupiter limits are dynamic; Helius limits depend on plan tier
7. **Use Jupiter Plugin for quick swap UIs** — Don't build swap from scratch unless you need custom routing control
8. **Check Token Shield before displaying tokens** — Combine with Helius DAS metadata for comprehensive safety checks
9. **For perps, read on-chain accounts via Helius** — No REST API exists; use `getAccountInfo` and `getProgramAccounts`
