import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerDasTools } from './das.js';
import { registerRpcTools } from './rpc.js';
import { registerEnhancedTransactionTools } from './enhanced-transactions.js';
import { registerPriorityFeeTools } from './priority-fees.js';
import { registerWebhookTools } from './webhooks.js';
import { registerConfigTools } from './config.js';
import { registerEnhancedWebSocketTools } from './enhanced-websockets.js';
import { registerLaserstreamTools } from './laserstream.js';

export function registerTools(server: McpServer) {
  registerConfigTools(server);
  registerDasTools(server);
  registerRpcTools(server);
  registerEnhancedTransactionTools(server);
  registerPriorityFeeTools(server);
  registerWebhookTools(server);
  registerEnhancedWebSocketTools(server);
  registerLaserstreamTools(server);
}
