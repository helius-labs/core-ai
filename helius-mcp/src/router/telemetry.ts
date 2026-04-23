import { z } from 'zod';
import { sendFeedbackEvent } from '../utils/feedback.js';

const requiredTelemetryString = (description: string) => z.string().trim().min(1).describe(description);

export const TELEMETRY_FIELDS = {
  _feedback: requiredTelemetryString('Short reason for this call or takeaway from the previous result, e.g. "initial balance check" or "balance looked healthy, checking history".'),
  _feedbackTool: requiredTelemetryString('Current public tool and action in "tool.action" form, e.g. "heliusWallet.getBalance".'),
  _model: requiredTelemetryString('LLM model identifier, for example claude-opus-4-6 or gpt-4o.'),
} as const;

export type TelemetryPayload = {
  _feedback: string;
  _feedbackTool: string;
  _model: string;
};

type PublicToolResponse = {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
  _meta?: Record<string, unknown>;
};

export function withTelemetry<T extends Record<string, z.ZodTypeAny>>(shape: T): T & typeof TELEMETRY_FIELDS {
  return {
    ...shape,
    ...TELEMETRY_FIELDS,
  };
}

export function splitTelemetry(
  params: Record<string, unknown>,
): { telemetry: TelemetryPayload; cleanParams: Record<string, unknown> } {
  const { _feedback, _feedbackTool, _model, ...cleanParams } = params;

  return {
    telemetry: {
      _feedback: String(_feedback ?? '').trim(),
      _feedbackTool: String(_feedbackTool ?? '').trim(),
      _model: String(_model ?? '').trim(),
    },
    cleanParams,
  };
}

export function normalizeTelemetry(
  toolName: string,
  params: Record<string, unknown>,
  telemetry: TelemetryPayload,
): TelemetryPayload {
  const action = typeof params.action === 'string' ? params.action : undefined;
  const currentTarget = action ? `${toolName}.${action}` : toolName;
  const feedbackTool = telemetry._feedbackTool === 'none' ? currentTarget : telemetry._feedbackTool;
  const feedback = telemetry._feedback === 'first_call'
    ? `initial ${currentTarget}`
    : telemetry._feedback;

  return {
    _feedback: feedback,
    _feedbackTool: feedbackTool,
    _model: telemetry._model,
  };
}

export function withTelemetryHandler(
  toolName: string,
  handler: (
    params: Record<string, unknown>,
    extra: unknown,
    telemetry: TelemetryPayload,
  ) => Promise<PublicToolResponse> | PublicToolResponse,
) {
  return async (params: Record<string, unknown>, extra: unknown) => {
    const { telemetry, cleanParams } = splitTelemetry(params);
    const normalizedTelemetry = normalizeTelemetry(toolName, cleanParams, telemetry);

    sendFeedbackEvent({
      type: 'tool_call',
      toolName,
      feedback: normalizedTelemetry._feedback,
      feedbackTool: normalizedTelemetry._feedbackTool,
      model: normalizedTelemetry._model,
    });

    return handler(cleanParams, extra, normalizedTelemetry);
  };
}
