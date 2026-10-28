import { z, type ZodRawShape } from 'zod';
import { registerAuthTools } from '../tools/auth.js';
import { registerConfigTools } from '../tools/config.js';
import { registerPlanTools } from '../tools/plans.js';
import { registerBalanceTools } from '../tools/balance.js';
import { registerTransactionTools } from '../tools/transactions.js';
import { registerAssetTools } from '../tools/assets.js';
import { registerAccountTools } from '../tools/accounts.js';
import { registerFeeTools } from '../tools/fees.js';
import { registerNetworkTools } from '../tools/network.js';
import { registerBlockTools } from '../tools/blocks.js';
import { registerTokenTools } from '../tools/tokens.js';
import { registerDasExtraTools } from '../tools/das-extras.js';
import { registerWebhookTools } from '../tools/webhooks.js';
import { registerEnhancedWebSocketTools } from '../tools/enhanced-websockets.js';
import { registerLaserstreamTools } from '../tools/laserstream.js';
import { registerWalletTools } from '../tools/wallet.js';
import { registerDocsTools } from '../tools/docs.js';
import { registerGuideTools } from '../tools/guides.js';
import { registerRecommendTools } from '../tools/recommend.js';
import { registerSolanaKnowledgeTools } from '../tools/solana-knowledge.js';
import { registerTransferTools } from '../tools/transfers.js';
import { registerZkCompressionTools } from '../tools/zk-compression.js';
import { registerStakingTools } from '../tools/staking.js';
import type { ActionName } from './actions.js';
import type { ActionArgs, ActionRegistry } from './action-registry.js';
import type { ContinuationHint } from '../results/types.js';

export type ActionHandlerResponse = {
  content?: Array<{ type?: string; text?: string }>;
  isError?: boolean;
  structuredContent?: unknown;
  /** Structured next-page metadata; the router uses it to build continuation state. */
  continuation?: ContinuationHint;
};

export type ActionHandler = (
  params: Record<string, unknown>,
  extra: unknown,
) => Promise<ActionHandlerResponse> | ActionHandlerResponse;

export type ActionHandlerDefinition = {
  name: ActionName;
  description?: string;
  inputSchema?: unknown;
  handler: ActionHandler;
};

function isZodType(value: unknown): value is z.ZodType {
  return typeof value === 'object' && value !== null && typeof (value as z.ZodType).safeParse === 'function';
}

function buildRuntimeSchema(inputSchema: unknown): z.ZodObject<ZodRawShape> | null {
  if (isZodType(inputSchema) && 'loose' in inputSchema && typeof inputSchema.loose === 'function') {
    return inputSchema.loose() as z.ZodObject<ZodRawShape>;
  }

  if (!inputSchema || typeof inputSchema !== 'object' || Array.isArray(inputSchema)) {
    return null;
  }

  // Zod 4 types `ZodRawShape` as read-only, so collect into a plain record.
  const rawShape: Record<string, z.ZodType> = {};
  for (const [key, value] of Object.entries(inputSchema)) {
    if (isZodType(value)) {
      rawShape[key] = value;
    }
  }

  if (Object.keys(rawShape).length === 0) {
    return null;
  }

  return z.looseObject(rawShape);
}

function materializeActionParams(tool: ActionHandlerDefinition, params: Record<string, unknown>): Record<string, unknown> {
  const schema = buildRuntimeSchema(tool.inputSchema);
  if (!schema) {
    return params;
  }

  const parsed = schema.safeParse(params);
  if (parsed.success) {
    return parsed.data;
  }

  const issue = parsed.error.issues[0];
  const path = issue?.path?.length ? issue.path.join('.') : 'input';
  const message = `Invalid parameters for ${tool.name}: ${path} ${issue?.message ?? 'is invalid'}`.trim();
  throw new Error(message);
}

class ActionHandlerCollector implements ActionRegistry {
  readonly tools = new Map<ActionName, ActionHandlerDefinition>();

  registerAction<Shape extends ZodRawShape>(
    name: ActionName,
    description: string,
    inputSchema: Shape,
    handler: (args: ActionArgs<Shape>, extra: unknown) => ActionHandlerResponse | Promise<ActionHandlerResponse>,
  ): void {
    if (typeof handler !== 'function') {
      throw new Error(`Action handler "${name}" is missing a callable handler`);
    }

    // Handlers are invoked as `handler(args, extra)`, so one written
    // `async (extra) => ...` binds its only parameter to *args* and silently
    // drops the request context. TypeScript accepts it — a 1-arity function is
    // assignable to a 2-arity signature — and the result type-checks, runs, and
    // returns plausible output built from the wrong credential.
    //
    // Checked at registration rather than by scanning source: a renamed
    // parameter or a differently quoted tool name defeats a scanner, while
    // arity is what the call site actually depends on. An empty-schema tool
    // that wants no args declares `(_args, extra)`.
    const schemaIsEmpty = Object.keys(inputSchema).length === 0;

    if (schemaIsEmpty && handler.length === 1) {
      throw new Error(
        `Action handler "${name}" takes no arguments but declares one parameter. `
        + 'Handlers are called as (args, extra), so that parameter binds to args — '
        + 'always {} here — and the request context is discarded. Use (_args, extra).',
      );
    }

    this.tools.set(name, {
      name,
      description,
      inputSchema,
      handler: handler as ActionHandler,
    });
  }
}

let cachedActionHandlers: Map<ActionName, ActionHandlerDefinition> | null = null;

export function registerActionHandlers(registry: ActionRegistry): void {
  registerAuthTools(registry);
  registerConfigTools(registry);
  registerPlanTools(registry);
  registerBalanceTools(registry);
  registerTransactionTools(registry);
  registerAssetTools(registry);
  registerAccountTools(registry);
  registerFeeTools(registry);
  registerNetworkTools(registry);
  registerBlockTools(registry);
  registerTokenTools(registry);
  registerDasExtraTools(registry);
  registerWebhookTools(registry);
  registerEnhancedWebSocketTools(registry);
  registerLaserstreamTools(registry);
  registerWalletTools(registry);
  registerDocsTools(registry);
  registerGuideTools(registry);
  registerRecommendTools(registry);
  registerSolanaKnowledgeTools(registry);
  registerTransferTools(registry);
  registerZkCompressionTools(registry);
  registerStakingTools(registry);
}

export function getActionHandlers(): Map<ActionName, ActionHandlerDefinition> {
  if (cachedActionHandlers) {
    return cachedActionHandlers;
  }

  const collector = new ActionHandlerCollector();
  registerActionHandlers(collector);
  cachedActionHandlers = collector.tools;
  return cachedActionHandlers;
}

export async function callActionHandler(
  action: ActionName,
  params: Record<string, unknown>,
  extra: unknown,
): Promise<ActionHandlerResponse> {
  const tool = getActionHandlers().get(action);
  if (!tool) {
    throw new Error(`No action handler registered for action "${action}"`);
  }

  const normalizedParams = materializeActionParams(tool, params);
  return await Promise.resolve(tool.handler(normalizedParams, extra));
}
