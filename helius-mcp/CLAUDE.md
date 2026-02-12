# helius-mcp

MCP (Model Context Protocol) server that exposes Helius/Solana data tools for AI assistants.

## Directory Structure

```
src/
  index.ts             # Entry point — MCP server setup, tool registration
  tools/               # Tool definitions (one file per tool group)
    balance.ts
    assets.ts
    transactions.ts
    webhooks.ts
    network.ts
    wallet.ts
    ...
  utils/
    helius.ts          # SDK client wrapper — getHeliusClient(), rpcRequest(), dasRequest(), restRequest()
```

## Tool Registration Pattern

Each tool file exports tool definitions registered in `index.ts`. Tools use the helius-sdk `createHelius()` for SDK methods and `restRequest()`/`rpcRequest()`/`dasRequest()` for non-SDK endpoints.

## SDK vs Raw Fetch

- **SDK** (`getHeliusClient()`): DAS API methods, webhooks, enhanced transactions
- **RPC** (`rpcRequest()`): Standard Solana RPC (getBalance, getAccountInfo, etc.)
- **DAS** (`dasRequest()`): DAS API via JSON-RPC
- **REST** (`restRequest()`): Wallet API (`/v1/wallet/...`), enhanced transactions (`/v0/transactions`)

## API Key Management

- Session key set via `setHeliusApiKey` tool
- Falls back to `HELIUS_API_KEY` environment variable
- Network defaults to `mainnet-beta`, configurable via `setNetwork()`

## Build / Dev

```bash
pnpm install
pnpm build          # tsc → dist/
pnpm dev            # Development mode
```
