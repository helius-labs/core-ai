import { createHelius, type HeliusClient } from "helius-sdk";
import { getApiKey as getConfigApiKey, getNetwork as getConfigNetwork, getJwt, getProjectId, getSharedApiKey } from "./config.js";
import { listProjects, getProject } from "./api.js";

let cachedClient: HeliusClient | null = null;
let cachedClientKey: string | null = null;
let cachedClientNetwork: string | null = null;

export interface ResolveOptions {
  apiKey?: string;
  network?: string;
}

/**
 * Resolve an API key from: CLI flag > env var > config file > auto-resolve from JWT
 */
export async function resolveApiKey(opts: ResolveOptions = {}): Promise<string> {
  // 1. CLI flag
  if (opts.apiKey) return opts.apiKey;

  // 2. Environment variable
  if (process.env.HELIUS_API_KEY) return process.env.HELIUS_API_KEY;

  // 3. CLI config file (~/.helius-cli/config.json)
  const configKey = getConfigApiKey();
  if (configKey) return configKey;

  // 4. Shared config file (~/.helius/config.json)
  const sharedKey = getSharedApiKey();
  if (sharedKey) return sharedKey;

  // 5. Auto-resolve from JWT (fetch first project's first API key)
  const jwt = getJwt();
  if (jwt) {
    try {
      const projectId = getProjectId();
      if (projectId) {
        const project = await getProject(jwt, projectId);
        if (project.apiKeys?.length) return project.apiKeys[0].keyId;
      }
      // Fallback: list projects and use first one
      const projects = await listProjects(jwt);
      if (projects.length > 0) {
        const details = await getProject(jwt, projects[0].id);
        if (details.apiKeys?.length) return details.apiKeys[0].keyId;
      }
    } catch {
      // Fall through to error
    }
  }

  throw new Error(
    "No API key found. Set one with:\n" +
    "  helius config set-api-key <key>\n" +
    "  --api-key <key> flag\n" +
    "  HELIUS_API_KEY environment variable"
  );
}

/**
 * Resolve the network from CLI flag > env var > config file
 */
export function resolveNetwork(opts: ResolveOptions = {}): "mainnet" | "devnet" {
  if (opts.network === "mainnet" || opts.network === "mainnet-beta") return "mainnet";
  if (opts.network === "devnet") return "devnet";
  if (process.env.HELIUS_NETWORK === "devnet") return "devnet";
  if (process.env.HELIUS_NETWORK === "mainnet-beta" || process.env.HELIUS_NETWORK === "mainnet") return "mainnet";
  return getConfigNetwork();
}

/**
 * Get a cached HeliusClient instance
 */
export function getClient(apiKey: string, network?: string): HeliusClient {
  const resolvedNetwork = network === "devnet" ? "devnet" : "mainnet";
  if (cachedClient && cachedClientKey === apiKey && cachedClientNetwork === resolvedNetwork) {
    return cachedClient;
  }
  cachedClient = createHelius({ apiKey, network: resolvedNetwork });
  cachedClientKey = apiKey;
  cachedClientNetwork = resolvedNetwork;
  return cachedClient;
}

/**
 * REST request helper for Wallet API endpoints (not in SDK)
 */
export async function restRequest(endpoint: string, apiKey: string, options: RequestInit = {}): Promise<any> {
  const separator = endpoint.includes("?") ? "&" : "?";
  const url = `https://api.helius.xyz${endpoint}${separator}api-key=${apiKey}`;

  const headers: Record<string, string> = { ...(options.headers as Record<string, string>) };
  if (options.body) {
    headers["Content-Type"] ??= "application/json";
  }

  const response = await fetch(url, { ...options, headers });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`HTTP ${response.status}: ${text}`);
  }

  const text = await response.text();
  if (!text || text === "null") return null;
  return JSON.parse(text);
}
