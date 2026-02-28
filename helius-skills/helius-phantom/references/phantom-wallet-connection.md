# Phantom Wallet Connection

## Overview

Phantom is the most popular Solana wallet. There are two integration approaches:

| Approach | When to use | Package |
|---|---|---|
| **Direct Phantom provider** (`window.phantom.solana`) | Prototypes, Phantom-only apps, learning | None |
| **Wallet Adapter** (`@solana/wallet-adapter-react`) | Production multi-wallet apps | `@solana/wallet-adapter-react`, `@solana/wallet-adapter-wallets`, `@solana/wallet-adapter-react-ui` |

**Default recommendation**: Use Wallet Adapter for any production application. Use the direct provider only for quick prototypes or when you specifically want Phantom-only support.

## Direct Phantom Provider

### Detecting Phantom

Always use `window.phantom?.solana` — never `window.solana` (which may be overridden by other wallets):

```typescript
function getPhantomProvider(): PhantomSolanaProvider | null {
  if (typeof window === 'undefined') return null;
  const provider = window.phantom?.solana;
  if (provider?.isPhantom) return provider;
  return null;
}

interface PhantomSolanaProvider {
  isPhantom: boolean;
  publicKey: { toBase58(): string; toBytes(): Uint8Array } | null;
  isConnected: boolean;
  connect(opts?: { onlyIfTrusted?: boolean }): Promise<{ publicKey: { toBase58(): string } }>;
  disconnect(): Promise<void>;
  signTransaction<T extends Transaction | VersionedTransaction>(tx: T): Promise<T>;
  signAllTransactions<T extends Transaction | VersionedTransaction>(txs: T[]): Promise<T[]>;
  signMessage(message: Uint8Array): Promise<{ signature: Uint8Array }>;
  on(event: string, callback: (...args: any[]) => void): void;
  off(event: string, callback: (...args: any[]) => void): void;
}
```

### Connecting

```typescript
async function connectPhantom(): Promise<string | null> {
  const provider = getPhantomProvider();

  if (!provider) {
    // Phantom not installed — redirect to install page
    window.open('https://phantom.app/', '_blank');
    return null;
  }

  try {
    const response = await provider.connect();
    return response.publicKey.toBase58();
  } catch (error: any) {
    if (error.code === 4001) {
      // User rejected the connection request
      console.log('User rejected connection');
    }
    return null;
  }
}
```

### Auto-Reconnect (Trusted Connection)

Use `onlyIfTrusted: true` to silently reconnect returning users without showing the popup. Call this on page load:

```typescript
async function autoReconnect(): Promise<string | null> {
  const provider = getPhantomProvider();
  if (!provider) return null;

  try {
    // Only connects if user has previously approved this site
    const response = await provider.connect({ onlyIfTrusted: true });
    return response.publicKey.toBase58();
  } catch {
    // Not trusted yet — user hasn't connected before or revoked access
    return null;
  }
}
```

### Event Listeners

Phantom emits events when the wallet state changes. Always clean up listeners:

```typescript
function usePhantomEvents(provider: PhantomSolanaProvider) {
  useEffect(() => {
    const handleAccountChanged = (publicKey: { toBase58(): string } | null) => {
      if (publicKey) {
        // User switched to a different account
        console.log('Switched to:', publicKey.toBase58());
      } else {
        // User disconnected via Phantom UI
        console.log('Disconnected');
      }
    };

    const handleDisconnect = () => {
      console.log('Wallet disconnected');
    };

    provider.on('accountChanged', handleAccountChanged);
    provider.on('disconnect', handleDisconnect);

    return () => {
      provider.off('accountChanged', handleAccountChanged);
      provider.off('disconnect', handleDisconnect);
    };
  }, [provider]);
}
```

**Events reference:**

| Event | Fires when | Callback argument |
|---|---|---|
| `accountChanged` | User switches account in Phantom | `publicKey` (or `null` if disconnected) |
| `disconnect` | Wallet disconnected | None |
| `connect` | Wallet connected | `publicKey` |

### Disconnecting

```typescript
async function disconnectPhantom() {
  const provider = getPhantomProvider();
  if (provider) {
    await provider.disconnect();
  }
}
```

### Complete React Hook (Direct Provider)

```typescript
import { useState, useEffect, useCallback } from 'react';

interface PhantomState {
  provider: PhantomSolanaProvider | null;
  publicKey: string | null;
  connected: boolean;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
}

function usePhantom(): PhantomState {
  const [provider, setProvider] = useState<PhantomSolanaProvider | null>(null);
  const [publicKey, setPublicKey] = useState<string | null>(null);

  useEffect(() => {
    const p = getPhantomProvider();
    setProvider(p);
    if (!p) return;

    // Auto-reconnect trusted users
    p.connect({ onlyIfTrusted: true })
      .then((resp) => setPublicKey(resp.publicKey.toBase58()))
      .catch(() => {});

    const handleAccountChanged = (pk: { toBase58(): string } | null) => {
      setPublicKey(pk ? pk.toBase58() : null);
    };
    const handleDisconnect = () => setPublicKey(null);

    p.on('accountChanged', handleAccountChanged);
    p.on('disconnect', handleDisconnect);

    return () => {
      p.off('accountChanged', handleAccountChanged);
      p.off('disconnect', handleDisconnect);
    };
  }, []);

  const connect = useCallback(async () => {
    if (!provider) {
      window.open('https://phantom.app/', '_blank');
      return;
    }
    try {
      const resp = await provider.connect();
      setPublicKey(resp.publicKey.toBase58());
    } catch {}
  }, [provider]);

  const disconnect = useCallback(async () => {
    if (provider) {
      await provider.disconnect();
      setPublicKey(null);
    }
  }, [provider]);

  return {
    provider,
    publicKey,
    connected: !!publicKey,
    connect,
    disconnect,
  };
}
```

## Wallet Adapter (Production)

The Solana Wallet Adapter supports Phantom plus 20+ other wallets with a unified interface.

### Setup

```bash
npm install @solana/wallet-adapter-react @solana/wallet-adapter-react-ui @solana/wallet-adapter-wallets @solana/web3.js
```

### Provider Nesting

Wrap your app with three providers in this exact order:

```tsx
import { ConnectionProvider, WalletProvider } from '@solana/wallet-adapter-react';
import { WalletModalProvider } from '@solana/wallet-adapter-react-ui';
import { PhantomWalletAdapter } from '@solana/wallet-adapter-wallets';

import '@solana/wallet-adapter-react-ui/styles.css';

const wallets = [new PhantomWalletAdapter()];

function App({ children }: { children: React.ReactNode }) {
  // Use your backend proxy URL, NOT your raw Helius RPC with API key
  const endpoint = '/api/rpc';

  return (
    <ConnectionProvider endpoint={endpoint}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>
          {children}
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}
```

**IMPORTANT**: Pass an empty array `[]` for `wallets` to auto-detect all installed wallets via the Wallet Standard. Only pass specific adapters if you want to limit the wallet list. Phantom implements the Wallet Standard, so it appears automatically with `wallets={[]}`.

### Using the Wallet

```tsx
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';

function WalletInfo() {
  const { publicKey, connected, signTransaction, signMessage, disconnect } = useWallet();
  const { connection } = useConnection();

  if (!connected || !publicKey) {
    return <WalletMultiButton />;
  }

  return (
    <div>
      <p>Connected: {publicKey.toBase58()}</p>
      <WalletMultiButton />
    </div>
  );
}
```

### Key Hooks

| Hook | Returns | Use for |
|---|---|---|
| `useWallet()` | `publicKey`, `connected`, `signTransaction`, `signAllTransactions`, `signMessage`, `connect`, `disconnect`, `wallet`, `wallets` | All wallet operations |
| `useConnection()` | `connection` (Solana `Connection` instance) | RPC calls |

### autoConnect

When `autoConnect` is set on `WalletProvider`, it automatically reconnects the last used wallet on page load (equivalent to `onlyIfTrusted` for Phantom).

## Mobile Support

On mobile, Phantom runs as an in-app browser. If the user opens your site in a regular mobile browser, Phantom won't be available as a browser extension.

### Basic Mobile Detection + Deep Link

```typescript
function connectWalletMobile() {
  const provider = getPhantomProvider();

  if (provider) {
    // Phantom is available (desktop extension or Phantom in-app browser)
    return provider.connect();
  }

  // Mobile browser without Phantom — redirect to Phantom deep link
  const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  if (isMobile) {
    // Open current page inside Phantom's in-app browser
    const currentUrl = encodeURIComponent(window.location.href);
    window.location.href = `https://phantom.app/ul/browse/${currentUrl}`;
    return;
  }

  // Desktop without Phantom — prompt to install
  window.open('https://phantom.app/', '_blank');
}
```

**Deep link format**: `https://phantom.app/ul/browse/{encoded_url}` opens the URL in Phantom's in-app browser where `window.phantom.solana` is available.

For more advanced mobile patterns (Solana Mobile Wallet Adapter for native Android/iOS), see the Phantom docs at `https://docs.phantom.com/phantom-deeplinks`.

## Common Mistakes

- **Using `window.solana` instead of `window.phantom?.solana`** — `window.solana` may be set by any wallet and is deprecated. Always use the namespaced provider.
- **Not handling `connect` rejection (code 4001)** — user may decline. Always wrap `connect()` in try/catch.
- **Not listening for `accountChanged`** — user can switch accounts in Phantom at any time. Your app will show stale data if you don't handle this.
- **Not cleaning up event listeners** — causes memory leaks in React. Always remove listeners in `useEffect` cleanup.
- **Calling `connect()` without `onlyIfTrusted` on page load** — this shows the popup on every page load. Use `onlyIfTrusted: true` for auto-reconnect.
- **Exposing Helius RPC URL in `ConnectionProvider endpoint`** — the endpoint is visible in client code. Use a backend proxy URL (e.g., `/api/rpc`), not `https://mainnet.helius-rpc.com/?api-key=KEY`. See `references/frontend-security.md`.
- **Forgetting `@solana/wallet-adapter-react-ui/styles.css`** — the wallet modal and buttons render unstyled.
- **Not handling mobile** — on mobile browsers, `window.phantom` is `undefined`. Use deep links to redirect users to Phantom's in-app browser.
