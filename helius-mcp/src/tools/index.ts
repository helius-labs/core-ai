import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerAuthTools } from './auth.js';
import { registerConfigTools } from './config.js';
import { registerBalanceTools } from './balance.js';
import { registerTransactionTools } from './transactions.js';
import { registerAssetTools } from './assets.js';
import { registerAccountTools } from './accounts.js';
import { registerFeeTools } from './fees.js';
import { registerNetworkTools } from './network.js';
import { registerBlockTools } from './blocks.js';
import { registerTokenTools } from './tokens.js';
import { registerDasExtraTools } from './das-extras.js';
import { registerWebhookTools } from './webhooks.js';
import { registerEnhancedWebSocketTools } from './enhanced-websockets.js';
import { registerLaserstreamTools } from './laserstream.js';
import { registerWalletTools } from './wallet.js';
import { registerPlanTools } from './plans.js';

export function registerTools(server: McpServer) {
  registerAuthTools(server);
  registerConfigTools(server);
  registerPlanTools(server);
  registerBalanceTools(server);
  registerTransactionTools(server);
  registerAssetTools(server);
  registerAccountTools(server);
  registerFeeTools(server);
  registerNetworkTools(server);
  registerBlockTools(server);
  registerTokenTools(server);
  registerDasExtraTools(server);
  registerWebhookTools(server);
  registerEnhancedWebSocketTools(server);
  registerLaserstreamTools(server);
  registerWalletTools(server);
}
