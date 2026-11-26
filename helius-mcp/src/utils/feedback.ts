import { version } from '../version.js';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import os from 'os';

const POSTHOG_ENDPOINT = 'https://www.helius.dev/relay-RMqE/capture/';
const POSTHOG_API_KEY = 'phc_aLmID5mMwUZi3pVhG4HomDeZaWZ1PqAEkWTempDogzi';
const HELIUS_DIR = path.join(os.homedir(), '.helius');
const ANON_ID_PATH = path.join(HELIUS_DIR, 'anon-id');

interface FeedbackEvent {
  type: 'tool_call' | 'discovery' | 'routing_miss';
  toolName?: string;
  feedback?: string;
  feedbackTool?: string;
  model?: string;
  discoveryPath?: string;
  frictionPoints?: string;
  /** routing_miss: the `action` the tool was called with. */
  requestedAction?: string;
  /** routing_miss: why it did not resolve (`RoutingMissKind`). */
  missKind?: string;
  /** routing_miss: the `tool.action` the error pointed to, if any. */
  suggestedTarget?: string;
}

let clientInfo: { name: string; version: string } | null = null;
let walletAddress: string | null = null;
let identifySent = false;

// Persistent anonymous ID shared with helius-cli.
let sessionId: string;
try {
  if (fs.existsSync(ANON_ID_PATH)) {
    sessionId = fs.readFileSync(ANON_ID_PATH, 'utf-8').trim();
  } else {
    sessionId = crypto.randomUUID();
    try {
      // Owner-only — this dir also holds the JWT/API-key config (see config.ts).
      fs.mkdirSync(HELIUS_DIR, { recursive: true, mode: 0o700 });
      fs.writeFileSync(ANON_ID_PATH, sessionId, 'utf-8');
    } catch {}
  }
} catch {
  sessionId = crypto.randomUUID();
}

export function captureClientInfo(info: { name: string; version: string }): void {
  clientInfo = info;
}

export function captureWalletAddress(address: string): void {
  const previousId = walletAddress ? null : sessionId;
  walletAddress = address;

  if (previousId && !identifySent) {
    identifySent = true;
    posthogCapture('$identify', {
      distinct_id: address,
      $anon_distinct_id: previousId,
    });
  }
}

function getDistinctId(): string {
  return walletAddress || sessionId;
}

function posthogCapture(event: string, properties: Record<string, unknown>): void {
  fetch(POSTHOG_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      api_key: POSTHOG_API_KEY,
      event,
      properties,
    }),
  }).catch(() => {
    /* ignore delivery failure */
  });
}

export function sendFeedbackEvent(event: FeedbackEvent): void {
  const eventName = event.type === 'discovery'
    ? 'agent_discovery'
    : event.type === 'routing_miss'
      ? 'agent_routing_miss'
      : 'agent_invocation';

  const properties: Record<string, unknown> = {
    distinct_id: getDistinctId(),
    helius_client: 'helius-mcp',
    helius_version: version,
  };

  if (clientInfo) {
    properties.mcp_client = `${clientInfo.name}/${clientInfo.version}`;
  }
  if (event.toolName) properties.current_tool = event.toolName;
  if (event.feedback) properties.feedback = event.feedback;
  if (event.feedbackTool) properties.feedback_tool = event.feedbackTool;
  if (event.model) properties.llm_model = event.model;
  if (event.discoveryPath) properties.discovery_path = event.discoveryPath;
  if (event.frictionPoints) properties.friction_points = event.frictionPoints;
  if (event.requestedAction) properties.requested_action = event.requestedAction;
  if (event.missKind) properties.miss_kind = event.missKind;
  if (event.suggestedTarget) properties.suggested_target = event.suggestedTarget;

  posthogCapture(eventName, properties);
}
