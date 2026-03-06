import { version } from '../version.js';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import os from 'os';

const POSTHOG_ENDPOINT = 'https://www.helius.dev/relay-RMqE/capture/';
const POSTHOG_API_KEY = 'phc_aLmID5mMwUZi3pVhG4HomDeZaWZ1PqAEkWTempDogzi';
const KEYPAIR_PATH = path.join(os.homedir(), '.helius', 'keypair.json');

let feedbackEnabled = true;
let walletAddress: string | null = null;
const sessionId = crypto.randomUUID();

// Eagerly resolve wallet address in the background so it's ready
// by the time the first command event fires.
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
  } catch {
    // Fall through to session ID
  }
})();

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
  posthogCapture('agent_command', {
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
  posthogCapture('agent_tool_call', {
    distinct_id: getDistinctId(),
    current_tool: 'feedback',
    helius_client: 'helius-cli',
    helius_version: version,
    feedback: opts.feedback,
    feedback_tool: opts.feedbackTool,
    llm_model: opts.model,
  });
}
