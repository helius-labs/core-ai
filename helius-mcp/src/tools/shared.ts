const NO_API_KEY_MESSAGE = `**Helius API Key Required**

I need a Helius API key to query the Solana blockchain.

**Get your key:**
1. Go to https://dashboard.helius.dev/api-keys
2. Sign in or sign up
3. Send your API key here in chat`;

export function noApiKeyResponse() {
  return {
    content: [{ type: 'text' as const, text: NO_API_KEY_MESSAGE }]
  };
}
