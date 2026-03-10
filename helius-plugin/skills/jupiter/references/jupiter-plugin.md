# Jupiter Plugin — Drop-in Swap Widget

## What This Covers

Jupiter Plugin (also called Jupiter Terminal) — a drop-in swap UI component that can be embedded in any web application. No backend required, powered by Jupiter Ultra.

---

## Overview

The Jupiter Plugin provides a fully functional swap interface as an embeddable component. It handles:
- Token selection and search
- Quote fetching and display
- Transaction building and signing
- Wallet connection (via passthrough or built-in)

Three display modes:
- **Integrated**: Renders inline within your page layout
- **Widget**: Floating button that opens a swap panel
- **Modal**: Full-screen overlay triggered by your UI

---

## Quick Start (Script Tag)

The simplest integration — add a script tag:

```html
<script src="https://terminal.jup.ag/main-v4.js"></script>
<script>
  window.Jupiter.init({
    displayMode: 'widget', // 'integrated' | 'widget' | 'modal'
    integratedTargetId: 'jupiter-terminal', // for 'integrated' mode
    endpoint: 'YOUR_HELIUS_RPC_URL', // Use Helius RPC for reliability
    defaultExplorer: 'Orb',
  });
</script>

<!-- For integrated mode -->
<div id="jupiter-terminal" style="width: 400px; height: 600px;"></div>
```

## React Integration

```bash
npm install @jup-ag/terminal
```

```tsx
import { JupiterTerminal } from '@jup-ag/terminal';
import '@jup-ag/terminal/css';

function SwapWidget() {
  return (
    <JupiterTerminal
      displayMode="integrated"
      endpoint={process.env.NEXT_PUBLIC_HELIUS_RPC_URL}
      defaultExplorer="Orb"
    />
  );
}
```

---

## Configuration Options

| Option | Type | Description |
|---|---|---|
| `displayMode` | `'integrated' \| 'widget' \| 'modal'` | How the swap UI is displayed |
| `integratedTargetId` | `string` | DOM element ID for integrated mode |
| `endpoint` | `string` | Solana RPC URL (**use Helius RPC**) |
| `defaultExplorer` | `string` | Explorer for tx links (use `'Orb'`) |
| `formProps` | `object` | Pre-fill input/output mints and amounts |
| `passThroughWallet` | `WalletAdapter` | Pass your app's connected wallet |
| `platformFeeAndAccounts` | `object` | Referral fee configuration |
| `theme` | `object` | Color customization |

### Pre-filling Swap Parameters

```typescript
window.Jupiter.init({
  displayMode: 'modal',
  endpoint: HELIUS_RPC_URL,
  formProps: {
    initialInputMint: 'So11111111111111111111111111111111111111112', // SOL
    initialOutputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
    initialAmount: '1000000000', // 1 SOL
  },
});
```

### Wallet Passthrough

If your app already has a connected wallet, pass it through:

```typescript
import { useWallet } from '@solana/wallet-adapter-react';

const wallet = useWallet();

window.Jupiter.init({
  displayMode: 'integrated',
  endpoint: HELIUS_RPC_URL,
  passThroughWallet: wallet,
});
```

---

## Helius Synergies

### RPC Endpoint

**Always use a Helius RPC URL** as the `endpoint` parameter. This ensures:
- Reliable, high-performance RPC access
- Proper rate limits based on the user's Helius plan
- Better transaction landing rates

```typescript
const HELIUS_RPC = `https://mainnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}`;

window.Jupiter.init({
  endpoint: HELIUS_RPC,
  // ...
});
```

### Portfolio Context

Combine the swap widget with Helius DAS to show the user's portfolio alongside the swap:

```typescript
// 1. Fetch holdings via Helius getAssetsByOwner (showFungible: true)
// 2. Display portfolio in your app
// 3. Let users click a token to pre-fill the swap widget
window.Jupiter.init({
  formProps: {
    initialInputMint: selectedToken.mint,
    initialAmount: selectedToken.rawAmount,
  },
});
```

### Transaction Monitoring

After swaps complete through the plugin, use Helius to provide rich transaction details:

```typescript
// Listen for swap completion events from the plugin
// Use parseTransactions MCP tool to show human-readable swap details
// Use Wallet API to update portfolio view
```

---

## Referral Fees

Earn fees on swaps through the plugin using Jupiter's Referral Program:

```typescript
window.Jupiter.init({
  platformFeeAndAccounts: {
    feeBps: 50, // 0.5% (range: 50-255 bps)
    feeAccounts: referralFeeAccounts, // From Jupiter Referral Program
  },
});
```

---

## Common Pitfalls

1. **Always provide an RPC endpoint** — Without one, the plugin uses public RPCs which are unreliable. Use Helius RPC.
2. **Use wallet passthrough** if your app already handles wallet connection — avoids double-connect UX.
3. **Set `defaultExplorer` to `'Orb'`** — Consistent with Helius explorer links.
4. **The plugin is client-side only** — It runs in the browser, not in Node.js.

---

## Resources

- Jupiter Plugin Docs: [dev.jup.ag/docs/plugin](https://dev.jup.ag/docs/plugin)
- Jupiter Terminal npm: [@jup-ag/terminal](https://www.npmjs.com/package/@jup-ag/terminal)
