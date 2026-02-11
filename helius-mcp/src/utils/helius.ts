import { createHelius, type HeliusClient } from 'helius-sdk';

let sessionApiKey: string | null = null;
let sessionNetwork: 'mainnet-beta' | 'devnet' = 'mainnet-beta';
let heliusClient: HeliusClient | null = null;

export function setApiKey(apiKey: string): void {
  sessionApiKey = apiKey;
  heliusClient = null; // Reset client so it picks up new key
}

export function getApiKey(): string {
  const apiKey = sessionApiKey || process.env.HELIUS_API_KEY;
  if (!apiKey) {
    throw new Error('NO_API_KEY: Set HELIUS_API_KEY environment variable or use setHeliusApiKey tool');
  }
  return apiKey;
}

export function hasApiKey(): boolean {
  return !!(sessionApiKey || process.env.HELIUS_API_KEY);
}

export function getHeliusClient(): HeliusClient {
  if (!heliusClient) {
    const apiKey = getApiKey();
    heliusClient = createHelius({ apiKey });
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

export function getRpcUrl(): string {
  const apiKey = getApiKey();
  const network = getNetwork();
  if (network === 'devnet') {
    return `https://devnet.helius-rpc.com/?api-key=${apiKey}`;
  }
  return `https://mainnet.helius-rpc.com/?api-key=${apiKey}`;
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
  const apiKey = getApiKey();
  const network = getNetwork();
  if (network === 'devnet') {
    return `https://laserstream-devnet-ewr.helius-rpc.com`;
  }
  const selectedRegion = region || 'ewr';
  return `https://laserstream-mainnet-${selectedRegion}.helius-rpc.com`;
}

export async function rpcRequest(method: string, params: any[] = []): Promise<any> {
  const url = getRpcUrl();
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method, params }),
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  const data = await response.json();
  if (data.error) {
    throw new Error(`RPC Error: ${data.error.message || JSON.stringify(data.error)}`);
  }
  return data.result;
}

export async function dasRequest(method: string, params: any = {}): Promise<any> {
  const url = getRpcUrl();
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method, params }),
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  const data = await response.json();
  if (data.error) {
    throw new Error(`DAS Error: ${data.error.message || JSON.stringify(data.error)}`);
  }
  return data.result;
}

export async function restRequest(endpoint: string, options: RequestInit = {}): Promise<any> {
  const apiKey = getApiKey();
  const separator = endpoint.includes('?') ? '&' : '?';
  const url = `https://api.helius.xyz${endpoint}${separator}api-key=${apiKey}`;

  const headers: Record<string, string> = { ...options.headers as Record<string, string> };
  if (options.body) {
    headers['Content-Type'] ??= 'application/json';
  }

  const response = await fetch(url, {
    ...options,
    headers,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`HTTP ${response.status}: ${text}`);
  }

  const text = await response.text();
  if (!text || text === 'null') {
    return null;
  }
  return JSON.parse(text);
}
