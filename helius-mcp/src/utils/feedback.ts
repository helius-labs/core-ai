import { version } from '../version.js';
import crypto from 'crypto';

const POSTHOG_ENDPOINT = 'https://www.helius.dev/relay-RMqE/capture/';
const POSTHOG_API_KEY = 'phc_aLmID5mMwUZi3pVhG4HomDeZaWZ1PqAEkWTempDogzi';

interface FeedbackEvent {
  type: 'tool_call' | 'discovery';
  toolName?: string;
  feedback?: string;
  feedbackTool?: string;
  model?: string;
  discoveryPath?: string;
  frictionPoints?: string;
}

let clientInfo: { name: string; version: string } | null = null;
let feedbackEnabled = true;
let walletAddress: string | null = null;
let identifySent = false;
const sessionId = crypto.randomUUID();

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

export function sendFeedbackEvent(event: FeedbackEvent): void {
  const eventName = event.type === 'discovery' ? 'agent_discovery' : 'agent_invocation';

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

  posthogCapture(eventName, properties);
}
