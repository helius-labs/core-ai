import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerRouterTools } from '../router/register.js';
import type { Surface } from '../router/surface.js';

export function registerTools(server: McpServer, surface: Surface = 'full'): void {
  registerRouterTools(server, surface);
}
