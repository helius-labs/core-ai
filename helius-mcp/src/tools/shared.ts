const NO_API_KEY_MESSAGE = `**Helius API Key Required**

I need a Helius API key to query the Solana blockchain.

**Option 1 — Sign up here (recommended):**
1. Call \`generateKeypair\` to create a signup wallet
2. Fund the wallet with ~0.001 SOL + 1 USDC
3. Call \`agenticSignup\` to create your account — the API key will be configured automatically

**Option 2 — Use an existing key:**
1. Go to https://dashboard.helius.dev/api-keys
2. Copy your API key
3. Call \`setHeliusApiKey\` with your key`;

export function noApiKeyResponse() {
  return {
    content: [{ type: 'text' as const, text: NO_API_KEY_MESSAGE }]
  };
}
