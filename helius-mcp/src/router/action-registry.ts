import type { z, ZodRawShape } from 'zod';
import type { ActionName } from './actions.js';
import type { ActionHandlerResponse } from './action-handlers.js';

/** A handler's arguments, as parsed from its input schema. */
export type ActionArgs<Shape extends ZodRawShape> = z.output<z.ZodObject<Shape>>;

/**
 * Where tool modules register their actions.
 *
 * Tool modules never talk to an MCP server: the public surface is the routed
 * tools in `router/register.ts`, and every action handler is collected here
 * and invoked through dispatch. Typing the modules against this interface,
 * rather than the SDK's `McpServer`, keeps them off the SDK's deprecated
 * `server.tool()` signature and makes the real call path explicit.
 */
export interface ActionRegistry {
  /**
   * Register one action's handler. `extra` is the SDK's per-request metadata,
   * forwarded unchanged; pass it to `contextFromExtra`.
   */
  registerAction<Shape extends ZodRawShape>(
    name: ActionName,
    description: string,
    inputSchema: Shape,
    handler: (args: ActionArgs<Shape>, extra: unknown) => ActionHandlerResponse | Promise<ActionHandlerResponse>,
  ): void;
}
