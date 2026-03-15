import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerRouterTools } from '../router/register.js';

export function registerTools(server: McpServer): void {
  registerRouterTools(server);
}
