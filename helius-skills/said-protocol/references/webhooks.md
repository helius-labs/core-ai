# Webhooks Reference

## Overview

Register a webhook URL to receive messages in real-time instead of polling the inbox. SAID pushes messages to your server as they arrive, with HMAC-SHA256 signature verification.

## Register Webhook

```bash
curl -X POST https://api.saidprotocol.com/xchain/webhook \
  -H "Content-Type: application/json" \
  -d '{
    "chain": "solana",
    "address": "YOUR_WALLET",
    "url": "https://your-server.com/webhook",
    "secret": "your-hmac-secret"
  }'
```

## Check Webhook Status

```bash
curl https://api.saidprotocol.com/xchain/webhook/solana/YOUR_WALLET
# { url, chain, address, createdAt, active }
```

## Delete Webhook

```bash
curl -X DELETE https://api.saidprotocol.com/xchain/webhook/solana/YOUR_WALLET
```

## Payload Format

```json
{
  "event": "message",
  "data": {
    "id": "msg_abc123",
    "from": { "chain": "base", "address": "SENDER_WALLET" },
    "to": { "chain": "solana", "address": "YOUR_WALLET" },
    "message": "Hello!",
    "timestamp": "2026-03-04T12:00:00Z"
  }
}
```

## Signature Verification

Every webhook includes `X-SAID-Signature` header. Verify with HMAC-SHA256:

```typescript
import crypto from "crypto";

function verifyWebhook(body: string, signature: string, secret: string): boolean {
  const expected = crypto
    .createHmac("sha256", secret)
    .update(body)
    .digest("hex");
  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expected)
  );
}

// In your webhook handler
app.post("/webhook", (req, res) => {
  const sig = req.headers["x-said-signature"] as string;
  if (!verifyWebhook(JSON.stringify(req.body), sig, "your-hmac-secret")) {
    return res.status(401).send("Invalid signature");
  }
  // Process message...
  res.status(200).send("OK");
});
```
