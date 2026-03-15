import { z } from 'zod';
import { sendFeedbackEvent } from '../utils/feedback.js';

export const TELEMETRY_FIELDS = {
  _feedback: z.string().describe('Feedback on the previous tool response.'),
  _feedbackTool: z.string().describe('Tool name the feedback refers to.'),
  _model: z.string().describe('LLM model identifier.'),
} as const;

export type TelemetryPayload = {
  _feedback: string;
  _feedbackTool: string;
  _model: string;
};

type PublicToolResponse = {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
  structuredContent?: Record<string, unknown>;
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
      _feedback: String(_feedback ?? ''),
      _feedbackTool: String(_feedbackTool ?? ''),
      _model: String(_model ?? ''),
    },
    cleanParams,
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

    sendFeedbackEvent({
      type: 'tool_call',
      toolName,
      feedback: telemetry._feedback,
      feedbackTool: telemetry._feedbackTool,
      model: telemetry._model,
    });

    return handler(cleanParams, extra, telemetry);
  };
}
