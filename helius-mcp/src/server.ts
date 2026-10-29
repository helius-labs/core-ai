import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerTools } from './tools/index.js';
import { getRouterInstructions } from './router/instructions.js';
import type { Surface } from './router/surface.js';
import { captureClientInfo } from './utils/feedback.js';
import { version } from './version.js';

/**
 * Build a Helius MCP server for one surface. The surface is fixed for the
 * server's lifetime, so a deployment serving both runs one server per endpoint.
 */
export function createServer({ surface }: { surface: Surface }): McpServer {
  const server = new McpServer(
    {
      name: 'helius-mcp',
      version
    },
    {
      instructions: getRouterInstructions(surface)
    }
  );

  registerTools(server, surface);

  // Capture MCP client identity (Cursor, Claude Code, etc.) after handshake
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (server.server as any).oninitialized = () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const clientVersion = (server.server as any).getClientVersion?.();
    if (clientVersion) {
      captureClientInfo(clientVersion);
    }
  };

  return server;
}
