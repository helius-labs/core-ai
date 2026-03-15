import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z, type ZodRawShape, type ZodTypeAny } from 'zod';
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
import type { LegacyActionName } from './legacy-actions.js';

export type LegacyToolResponse = {
  content?: Array<{ type?: string; text?: string }>;
  isError?: boolean;
  structuredContent?: unknown;
};

export type LegacyToolHandler = (
  params: Record<string, unknown>,
  extra: unknown,
) => Promise<LegacyToolResponse> | LegacyToolResponse;

export type LegacyToolDefinition = {
  name: LegacyActionName;
  description?: string;
  inputSchema?: unknown;
  handler: LegacyToolHandler;
};

function isZodType(value: unknown): value is ZodTypeAny {
  return typeof value === 'object' && value !== null && typeof (value as ZodTypeAny).safeParse === 'function';
}

function buildRuntimeSchema(inputSchema: unknown): z.ZodObject<ZodRawShape> | null {
  if (isZodType(inputSchema) && 'passthrough' in inputSchema && typeof inputSchema.passthrough === 'function') {
    return inputSchema.passthrough() as z.ZodObject<ZodRawShape>;
  }

  if (!inputSchema || typeof inputSchema !== 'object' || Array.isArray(inputSchema)) {
    return null;
  }

  const rawShape: ZodRawShape = {};
  for (const [key, value] of Object.entries(inputSchema)) {
    if (isZodType(value)) {
      rawShape[key] = value;
    }
  }

  if (Object.keys(rawShape).length === 0) {
    return null;
  }

  return z.object(rawShape).passthrough();
}

function materializeLegacyParams(tool: LegacyToolDefinition, params: Record<string, unknown>): Record<string, unknown> {
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

class LegacyToolCollector {
  readonly tools = new Map<LegacyActionName, LegacyToolDefinition>();

  tool(name: string, ...rest: unknown[]): void {
    let description: string | undefined;
    let inputSchema: unknown;

    if (typeof rest[0] === 'string') {
      description = rest.shift() as string;
    }

    if (rest.length > 1 && typeof rest[0] === 'object' && rest[0] !== null) {
      inputSchema = rest.shift();
    }

    const handler = rest[0];
    if (typeof handler !== 'function') {
      throw new Error(`Legacy tool "${name}" is missing a callable handler`);
    }

    this.tools.set(name as LegacyActionName, {
      name: name as LegacyActionName,
      description,
      inputSchema,
      handler: handler as LegacyToolHandler,
    });
  }
}

let cachedLegacyTools: Map<LegacyActionName, LegacyToolDefinition> | null = null;

export function registerLegacyTools(server: McpServer): void {
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
  registerDocsTools(server);
  registerGuideTools(server);
  registerRecommendTools(server);
  registerSolanaKnowledgeTools(server);
  registerTransferTools(server);
  registerZkCompressionTools(server);
  registerStakingTools(server);
}

export function getLegacyTools(): Map<LegacyActionName, LegacyToolDefinition> {
  if (cachedLegacyTools) {
    return cachedLegacyTools;
  }

  const collector = new LegacyToolCollector();
  registerLegacyTools(collector as unknown as McpServer);
  cachedLegacyTools = collector.tools;
  return cachedLegacyTools;
}

export async function callLegacyAction(
  action: LegacyActionName,
  params: Record<string, unknown>,
  extra: unknown,
): Promise<LegacyToolResponse> {
  const tool = getLegacyTools().get(action);
  if (!tool) {
    throw new Error(`No legacy executor registered for action "${action}"`);
  }

  const normalizedParams = materializeLegacyParams(tool, params);
  return await Promise.resolve(tool.handler(normalizedParams, extra));
}
