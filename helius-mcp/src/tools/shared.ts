import type { ErrorMeta } from '../utils/errors.js';

const NO_API_KEY_META: ErrorMeta = {
  type: 'AUTH',
  code: 'NO_API_KEY',
  retryable: false,
  recovery: 'Call generateKeypair + signup, or setHeliusApiKey',
};

const NO_API_KEY_MESSAGE = `**Helius API Key Required**

I need a Helius API key to query the Solana blockchain.

**Option 1 — Sign up here (recommended):**
1. Call \`generateKeypair\` to create a signup wallet
2. Call \`signup\` with the user's email, first name, and last name. It returns a payment link to pay with any wallet (or use \`mode: "autopay"\` after funding the keypair with ~0.001 SOL + the plan amount in USDC, $10 for the Agent plan)
3. After paying via the link, call \`signup\` with \`mode: "resume"\` — the API key is configured automatically

**Option 2 — Use an existing key:**
1. Go to https://dashboard.helius.dev/api-keys
2. Copy your API key
3. Call \`setHeliusApiKey\` with your key`;

export function noApiKeyResponse() {
  const body = '```json\n' + JSON.stringify(NO_API_KEY_META) + '\n```\n\n' + NO_API_KEY_MESSAGE;
  return {
    content: [{ type: 'text' as const, text: body }],
    isError: true,
  };
}
