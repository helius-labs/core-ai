import { version } from '../version.js';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import os from 'os';

const POSTHOG_ENDPOINT = 'https://www.helius.dev/relay-RMqE/capture/';
const POSTHOG_API_KEY = 'phc_aLmID5mMwUZi3pVhG4HomDeZaWZ1PqAEkWTempDogzi';
const HELIUS_DIR = path.join(os.homedir(), '.helius');
const KEYPAIR_PATH = path.join(HELIUS_DIR, 'keypair.json');
const WALLET_CACHE_PATH = path.join(HELIUS_DIR, 'wallet-address');

let feedbackEnabled = true;
let walletAddress: string | null = null;
let identifySent = false;

// Persistent anonymous ID so API-key-only users stay the same person across runs.
const ANON_ID_PATH = path.join(HELIUS_DIR, 'anon-id');
let sessionId: string;
try {
  if (fs.existsSync(ANON_ID_PATH)) {
    sessionId = fs.readFileSync(ANON_ID_PATH, 'utf-8').trim();
  } else {
    sessionId = crypto.randomUUID();
    try {
      fs.mkdirSync(HELIUS_DIR, { recursive: true });
      fs.writeFileSync(ANON_ID_PATH, sessionId, 'utf-8');
    } catch {}
  }
} catch {
  sessionId = crypto.randomUUID();
}

// Try cached wallet address first (synchronous, no race condition).
try {
  if (fs.existsSync(WALLET_CACHE_PATH)) {
    const cached = fs.readFileSync(WALLET_CACHE_PATH, 'utf-8').trim();
    if (cached.length >= 32 && cached.length <= 44) {
      walletAddress = cached;
    }
  }
} catch {
  // Fall through to async resolution
}

// If no cache, resolve from keypair and write cache for next run.
if (!walletAddress) {
  (async () => {
    try {
      if (!fs.existsSync(KEYPAIR_PATH)) return;
      const data = fs.readFileSync(KEYPAIR_PATH, 'utf-8');
      const arr = JSON.parse(data);
      if (!Array.isArray(arr) || arr.length !== 64) return;
      const { loadKeypair } = await import('helius-sdk/auth/loadKeypair');
      const { getAddress } = await import('helius-sdk/auth/getAddress');
      const keypair = loadKeypair(Uint8Array.from(arr));
      walletAddress = await getAddress(keypair);

      try { fs.writeFileSync(WALLET_CACHE_PATH, walletAddress, 'utf-8'); } catch {}

      if (!identifySent) {
        identifySent = true;
        posthogCapture('$identify', {
          distinct_id: walletAddress,
          $anon_distinct_id: sessionId,
        });
      }
    } catch {
      // Fall through to session ID
    }
  })();
}

function getDistinctId(): string {
  return walletAddress || sessionId;
}

function posthogCapture(event: string, properties: Record<string, unknown>): void {
  if (!feedbackEnabled) return;

  fetch(POSTHOG_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      api_key: POSTHOG_API_KEY,
      event,
      properties,
    }),
  }).catch(() => {
    feedbackEnabled = false;
  });
}

export function sendCommandEvent(
  commandName: string,
  options?: { exitCode?: number; success?: boolean },
): void {
  posthogCapture('agent_invocation', {
    distinct_id: getDistinctId(),
    current_tool: commandName,
    helius_client: 'helius-cli',
    helius_version: version,
    exit_code: options?.exitCode ?? 0,
    success: options?.success ?? true,
  });
}

export function sendDiscoveryEvent(opts: {
  discoveryPath?: string;
  frictionPoints?: string;
}): void {
  posthogCapture('agent_discovery', {
    distinct_id: getDistinctId(),
    helius_client: 'helius-cli',
    helius_version: version,
    discovery_path: opts.discoveryPath,
    friction_points: opts.frictionPoints,
  });
}

export function sendCliFeedback(opts: {
  feedback: string;
  feedbackTool?: string;
  model?: string;
}): void {
  posthogCapture('agent_invocation', {
    distinct_id: getDistinctId(),
    current_tool: 'feedback',
    helius_client: 'helius-cli',
    helius_version: version,
    feedback: opts.feedback,
    feedback_tool: opts.feedbackTool,
    llm_model: opts.model,
  });
}
