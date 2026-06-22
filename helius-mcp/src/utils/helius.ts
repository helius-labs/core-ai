import { createHelius, type HeliusClient } from 'helius-sdk';
import { MCP_USER_AGENT } from '../http.js';
import { getSharedApiKey } from './config.js';
import { wrapClientWithResilience, withResilience, READ_TIMEOUT_MS } from './resilience.js';

let sessionApiKey: string | null = null;
let sessionNetwork: 'mainnet-beta' | 'devnet' = 'mainnet-beta';
let heliusClient: HeliusClient | null = null;

// Session keypair storage for auth flow
let sessionSecretKey: Uint8Array | null = null;
let sessionWalletAddress: string | null = null;

export function setSessionSecretKey(key: Uint8Array): void {
  sessionSecretKey = key;
}

export function getSessionSecretKey(): Uint8Array | null {
  return sessionSecretKey;
}

export function setSessionWalletAddress(address: string): void {
  sessionWalletAddress = address;
}

export function getSessionWalletAddress(): string | null {
  return sessionWalletAddress;
}

export function setApiKey(apiKey: string): void {
  sessionApiKey = apiKey;
  heliusClient = null; // Reset client so it picks up new key
}

export function getApiKey(): string {
  const apiKey = sessionApiKey || process.env.HELIUS_API_KEY || getSharedApiKey();
  if (!apiKey) {
    throw new Error('NO_API_KEY: Set HELIUS_API_KEY environment variable or use setHeliusApiKey tool');
  }
  return apiKey;
}

export function hasApiKey(): boolean {
  return !!(sessionApiKey || process.env.HELIUS_API_KEY || getSharedApiKey());
}

export function getHeliusClient(): HeliusClient {
  if (!heliusClient) {
    const apiKey = getApiKey();
    // Wrap so idempotent reads get a timeout + retry-with-backoff; writes,
    // sends, and streaming pass through untouched. See utils/resilience.ts.
    heliusClient = wrapClientWithResilience(createHelius({ apiKey, userAgent: MCP_USER_AGENT }));
  }
  return heliusClient;
}

export function setNetwork(network: 'mainnet-beta' | 'devnet'): void {
  sessionNetwork = network;
}

export function getNetwork(): 'mainnet-beta' | 'devnet' {
  const envNetwork = process.env.HELIUS_NETWORK;
  if (envNetwork === 'devnet' || envNetwork === 'mainnet-beta') {
    return envNetwork;
  }
  return sessionNetwork;
}

export function getEnhancedWebSocketUrl(): string {
  const apiKey = getApiKey();
  const network = getNetwork();
  if (network === 'devnet') {
    return `wss://atlas-devnet.helius-rpc.com/?api-key=${apiKey}`;
  }
  return `wss://atlas-mainnet.helius-rpc.com/?api-key=${apiKey}`;
}

export function getLaserstreamUrl(region?: 'ewr' | 'pitt' | 'slc' | 'lax' | 'lon' | 'ams' | 'fra' | 'tyo' | 'sgp'): string {
  // Endpoint host is public; clients pass apiKey separately (e.g. @helius/laserstream subscribe options).
  // Do not call getApiKey() here or docs tools like getLaserstreamInfo fail unnecessarily.
  const network = getNetwork();
  if (network === 'devnet') {
    return `https://laserstream-devnet-ewr.helius-rpc.com`;
  }
  const selectedRegion = region || 'ewr';
  return `https://laserstream-mainnet-${selectedRegion}.helius-rpc.com`;
}

/**
 * Load the signer keypair from session or disk.
 * Returns the raw secret key bytes and the wallet address string.
 * Throws with message 'NO_KEYPAIR' if no keypair is available.
 */
export async function loadSignerOrFail(): Promise<{ secretKey: Uint8Array; walletAddress: string }> {
  // Lazy-import to avoid circular deps (config → helius → config)
  const { loadKeypairFromDisk } = await import('./config.js');
  const { loadKeypair } = await import('helius-sdk/auth/loadKeypair');
  const { getAddress } = await import('helius-sdk/auth/getAddress');

  let secretKey = getSessionSecretKey();
  if (!secretKey) {
    secretKey = loadKeypairFromDisk();
    if (secretKey) {
      const walletKeypair = loadKeypair(secretKey);
      const addr = await getAddress(walletKeypair);
      setSessionSecretKey(secretKey);
      setSessionWalletAddress(addr);
    }
  }
  if (!secretKey) {
    throw new Error('NO_KEYPAIR');
  }

  // Derive the address from the key if not already cached in session
  let walletAddress = getSessionWalletAddress();
  if (!walletAddress) {
    const walletKeypair = loadKeypair(secretKey);
    walletAddress = await getAddress(walletKeypair);
    setSessionWalletAddress(walletAddress);
  }
  return { secretKey, walletAddress };
}

export async function restRequest(endpoint: string, options: RequestInit = {}): Promise<any> {
  const apiKey = getApiKey();
  const separator = endpoint.includes('?') ? '&' : '?';
  const url = `https://api.helius.xyz${endpoint}${separator}api-key=${apiKey}`;

  const headers: Record<string, string> = { ...options.headers as Record<string, string> };
  headers['User-Agent'] = MCP_USER_AGENT;
  if (options.body) {
    headers['Content-Type'] ??= 'application/json';
  }

  // Reads here are idempotent: retry transient failures, and abort (not just
  // race) a hung request via AbortSignal so the socket is released.
  return withResilience(async () => {
    const response = await fetch(url, {
      ...options,
      headers,
      signal: AbortSignal.timeout(READ_TIMEOUT_MS),
    });

    if (!response.ok) {
      const text = await response.text();
      const error = new Error(`HTTP ${response.status}: ${text}`) as Error & { statusCode?: number };
      error.statusCode = response.status;
      throw error;
    }

    const text = await response.text();
    if (!text || text === 'null') {
      return null;
    }
    return JSON.parse(text);
  }, `restRequest ${endpoint}`, { timeoutMs: 0 });
}
