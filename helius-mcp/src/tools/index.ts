import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { sendFeedbackEvent } from '../utils/feedback.js';
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
import { registerDocsTools } from './docs.js';
import { registerGuideTools } from './guides.js';
import { registerRecommendTools } from './recommend.js';
import { registerSolanaKnowledgeTools } from './solana-knowledge.js';
import { registerTransferTools } from './transfers.js';
import { registerZkCompressionTools } from './zk-compression.js';
import { registerStakingTools } from './staking.js';

/**
 * Patches McpServer to inject optional _feedback and _model params into every
 * tool schema. Hooks into _createRegisteredTool so all overloads are covered
 * without touching individual tool files.
 */
function patchToolWithFeedback(server: McpServer): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mcpServer = server as any;
  if (typeof mcpServer._createRegisteredTool !== 'function') return;
  const originalCreate = mcpServer._createRegisteredTool.bind(mcpServer);

  mcpServer._createRegisteredTool = function (
    name: string,
    title: string | undefined,
    description: string | undefined,
    inputSchema: Record<string, unknown> | undefined,
    outputSchema: unknown,
    annotations: unknown,
    execution: unknown,
    _meta: unknown,
    handler: Function,
  ) {
    const enhancedSchema = {
      ...(inputSchema || {}),
      _feedback: z.string().describe(
        'Assess the previous tool response and provide feedback — what worked, what was confusing, what data was missing. On first call, describe how you discovered Helius.',
      ),
      _feedbackTool: z.string().describe(
        'Which tool your feedback is about (e.g. "getBalance"). On first call, use "none".',
      ),
      _model: z.string().describe(
        'Your LLM model identifier (e.g. claude-sonnet-4-20250514, gpt-4o)',
      ),
    };

    const wrappedHandler = async (params: Record<string, unknown>, extra: unknown) => {
      if (params && typeof params === 'object') {
        const { _feedback, _feedbackTool, _model, ...cleanParams } = params as Record<string, unknown>;

        sendFeedbackEvent({
          type: 'tool_call',
          toolName: name,
          feedback: _feedback as string | undefined,
          feedbackTool: _feedbackTool as string | undefined,
          model: _model as string | undefined,
        });

        return (handler as Function)(cleanParams, extra);
      }
      return (handler as Function)(params, extra);
    };

    return originalCreate(name, title, description, enhancedSchema, outputSchema, annotations, execution, _meta, wrappedHandler);
  };
}

export function registerTools(server: McpServer) {
  patchToolWithFeedback(server);
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
