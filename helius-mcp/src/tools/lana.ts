import { z } from 'zod';
import type { ActionRegistry } from '../router/action-registry.js';
import { getNetwork, hasApiKey, LANA_UNREADABLE_ANSWER, lanaRequest } from '../utils/helius.js';
import { handleToolError, mcpError, mcpText, type ErrorHandler, type ErrorMeta } from '../utils/errors.js';
import { contextFromExtra } from '../utils/request-context.js';
import { isReadOnlySurface, isSharedCredentialMode, READ_ONLY_GUIDANCE } from '../utils/runtime.js';
import { noApiKeyResponse } from './shared.js';

export const LANA_MODELS = ['lana-fast', 'lana-thinking'] as const;
export type LanaModel = typeof LANA_MODELS[number];

export const LANA_CREDITS_PER_CALL: Record<LanaModel, number> = {
  'lana-fast': 2_000,
  'lana-thinking': 10_000,
};

type LanaContentBlock = { type: string; text?: string };

type LanaSource = { index: number; url: string; title?: string };

type LanaMessage = {
  model?: string;
  content?: LanaContentBlock[];
  stop_reason?: 'end_turn' | 'max_tokens' | 'tool_use' | 'error' | string;
  sources?: LanaSource[];
  error?: { type?: string; message?: string };
};

type LanaRequest = {
  model: LanaModel;
  stream: false;
  messages: Array<{ role: 'user'; content: string }>;
  extensions: {
    read_only: true;
    user_context: { network: 'mainnet' | 'devnet'; wallet?: string };
  };
};

function credits(model: LanaModel): string {
  return `${LANA_CREDITS_PER_CALL[model].toLocaleString('en-US')} credits`;
}

export function linkCitations(text: string, sources: readonly LanaSource[] = []): string {
  const urls = new Map(sources.map((source) => [source.index, source.url]));
  return text.replace(/\{\{cite:(\d+)\}\}/g, (_marker, index: string) => {
    const url = urls.get(Number(index));
    return url ? ` [${Number(index) + 1}](${url})` : '';
  });
}

export function answerText(message: LanaMessage): string {
  const text = (message.content ?? [])
    .filter((block) => block.type === 'text' && block.text)
    .map((block) => block.text!.trim())
    .filter(Boolean)
    .join('\n\n');
  return linkCitations(text, message.sources);
}

function lanaError(message: string, meta: ErrorMeta) {
  return mcpError(`**Lana Error**\n\n${message}`, meta);
}

type LanaHttpError = { status: number; body: string; type?: string; message?: string };

export function parseLanaHttpError(msg: string): LanaHttpError | null {
  const match = msg.match(/^HTTP (\d{3}): ([\s\S]*)$/);
  if (!match) return null;
  const body = match[2];
  let error: { type?: string; message?: string } | undefined;
  try {
    error = (JSON.parse(body) as { error?: { type?: string; message?: string } }).error;
  } catch {
    error = undefined;
  }
  return { status: Number(match[1]), body, type: error?.type, message: error?.message };
}

function whenStatus(statuses: number[], predicate: (error: LanaHttpError) => boolean = () => true) {
  return (msg: string) => {
    const error = parseLanaHttpError(msg);
    return error !== null && statuses.includes(error.status) && predicate(error);
  };
}

function paidPlanRecovery(): string {
  return isReadOnlySurface()
    ? READ_ONLY_GUIDANCE.accountChanges
    : 'Call `heliusAccount` with `action: "upgradePlan"` to move to the Developer plan or above, or `previewUpgrade` to see the price first.';
}

function outOfCreditsRecovery(): string {
  return isReadOnlySurface()
    ? READ_ONLY_GUIDANCE.accountChanges
    : 'Call `heliusAccount` with `action: "purchaseCredits"` to top up, or `upgradePlan` for a larger plan.';
}

function lanaErrorHandlers(model: LanaModel): ErrorHandler[] {
  return [
    {
      match: (msg) => msg.startsWith(LANA_UNREADABLE_ANSWER),
      respond: () => {
        const recovery = 'Do not retry the same question right away; it would be charged again.';
        return lanaError(
          `Lana answered, but the response could not be read. This request was still charged ${credits(model)}.\n\n${recovery}`,
          { type: 'API', code: LANA_UNREADABLE_ANSWER, retryable: false, recovery },
        );
      },
    },
    {
      match: whenStatus([403]),
      respond: () => {
        const recovery = paidPlanRecovery();
        return lanaError(
          `Lana needs a paid Helius plan (Developer or above), so this API key's plan can't call it. If the plan is already paid, the key's access settings may block Lana; check them at https://dashboard.helius.dev.\n\n${recovery}`,
          { type: 'AUTH', code: 'LANA_PAID_PLAN_REQUIRED', retryable: false, recovery },
        );
      },
    },
    {
      match: whenStatus([429], (error) => error.body.includes('max usage reached')),
      respond: () => {
        const recovery = outOfCreditsRecovery();
        return lanaError(
          `This project is out of credits. Retrying fails until credits are added.\n\n${recovery}`,
          { type: 'INSUFFICIENT_FUNDS', code: 'OUT_OF_CREDITS', retryable: false, recovery },
        );
      },
    },
    {
      match: whenStatus([429], (error) => error.type === 'rate_limit_error'),
      respond: () => {
        const recovery = 'Wait about 5 seconds, then retry. Ask Lana one question at a time, not in parallel.';
        return lanaError(
          `This project already has about 3 Lana requests running.\n\n${recovery}`,
          { type: 'RATE_LIMIT', code: 'LANA_CONCURRENCY_LIMIT', retryable: true, recovery },
        );
      },
    },
    {
      match: whenStatus([503, 529]),
      respond: () => {
        const recovery = 'Retry in 5 to 30 seconds. Rejected requests are not charged.';
        return lanaError(
          `Lana is at capacity or restarting.\n\n${recovery}`,
          { type: 'HTTP', code: 'LANA_UNAVAILABLE', retryable: true, recovery },
        );
      },
    },
    {
      match: (msg) => whenStatus([504])(msg) || msg.includes('aborted due to timeout'),
      respond: () => {
        const recovery = model === 'lana-thinking'
          ? 'Ask a narrower question, or use `model: "lana-fast"`.'
          : 'Ask a narrower question.';
        return lanaError(
          `Lana ran out of time on this question.\n\n${recovery}`,
          { type: 'HTTP', code: 'LANA_TIMEOUT', retryable: false, recovery },
        );
      },
    },
    {
      match: whenStatus([400], (error) => error.type === 'context_overflow'),
      respond: () => {
        const recovery = 'Ask a narrower question, for example about fewer transactions or a shorter time range.';
        return lanaError(
          `The question and Lana's lookups didn't fit in its context window.\n\n${recovery}`,
          { type: 'VALIDATION', code: 'LANA_CONTEXT_OVERFLOW', retryable: false, recovery },
        );
      },
    },
    {
      match: whenStatus([400, 500, 502]),
      respond: (msg) => {
        const error = parseLanaHttpError(msg)!;
        const invalid = error.status === 400;
        const recovery = invalid ? 'Fix the request.' : 'Retry with backoff. Failed requests are not charged.';
        return lanaError(
          `${error.message ?? error.body}\n\n${recovery}`,
          { type: invalid ? 'VALIDATION' : 'API', code: error.type ?? `HTTP_${error.status}`, retryable: !invalid, recovery },
        );
      },
    },
  ];
}

function failedTurn(message: LanaMessage, model: LanaModel) {
  const reason = message.error?.message ?? 'The turn failed before Lana finished its answer.';
  const charged = `This request was still charged ${credits(model)}.`;
  const partial = answerText(message);
  if (partial) {
    return mcpText(`**Incomplete answer:** ${reason} ${charged} Ask a narrower follow-up for the rest.\n\n${partial}`);
  }
  const recovery = 'Retry, or ask a narrower question.';
  return lanaError(`${reason} ${charged}\n\n${recovery}`, { type: 'API', code: message.error?.type ?? 'api_error', retryable: true, recovery });
}

function attribution(message: LanaMessage, model: LanaModel): string {
  const cutOff = message.stop_reason === 'max_tokens' || message.stop_reason === 'tool_use'
    ? ' The answer may be cut off; ask a narrower follow-up for the rest.'
    : '';
  return `_Answered by ${model} for ${credits(model)}.${cutOff}_`;
}

function sharedCredentialRefusal() {
  const recovery = 'Run the Helius MCP locally with your own key (`npx helius-mcp@latest`) to ask Lana.';
  return lanaError(
    `Lana is unavailable on this server: it serves many callers from one shared API key, and each Lana call costs that key 2,000 to 10,000 credits.\n\n${recovery}`,
    { type: 'UNSUPPORTED', code: 'SHARED_CREDENTIAL', retryable: false, recovery },
  );
}

function cancellation(extra: unknown): AbortSignal | undefined {
  const signal = (extra as { signal?: unknown } | null | undefined)?.signal;
  return signal instanceof AbortSignal ? signal : undefined;
}

export function registerLanaTools(registry: ActionRegistry) {
  registry.registerAction(
    'ask',
    'Ask Lana, the Helius Solana AI agent, a question in plain English. Lana looks up wallets, tokens, transactions, and prices itself and answers with its findings. '
      + 'ONLY FOR: questions that need many lookups chained with judgment: why a transaction failed, how much slippage a swap got, where a wallet\'s funds came from or went, whether two wallets are connected. '
      + 'DO NOT USE when one data tool answers it (balances, holdings, top holders, fees paid, parsing a transaction, token info): heliusTransaction, heliusWallet, heliusAsset, and heliusChain are faster, return in about a second, and cost 1 to 100 credits a call. '
      + `COST: ${credits('lana-fast')} per call with lana-fast (default), ${credits('lana-thinking')} with lana-thinking. Ask once with the full question rather than in pieces. `
      + 'Needs a paid Helius plan (Developer or above). Each call is independent: include the context a follow-up needs in the question. lana-thinking can take a few minutes.',
    {
      question: z.string().trim().min(1).describe('The question for Lana, in plain English. Include every address, signature, or mint it is about.'),
      wallet: z.string().trim().min(1).max(128).optional().describe('The user\'s wallet address, so questions about "my wallet" or "my last transaction" work.'),
      model: z.enum(LANA_MODELS).optional().default('lana-fast').describe(`lana-fast (default, ${credits('lana-fast')}): quick lookups and single facts. lana-thinking (${credits('lana-thinking')}): multi-step analysis, up to a few minutes.`),
    },
    async ({ question, wallet, model }, extra) => {
      if (isSharedCredentialMode()) return sharedCredentialRefusal();
      const ctx = contextFromExtra(extra);
      if (!hasApiKey(ctx)) return noApiKeyResponse();

      const body: LanaRequest = {
        model,
        stream: false,
        messages: [{ role: 'user', content: question }],
        extensions: {
          read_only: true,
          user_context: {
            network: getNetwork(ctx) === 'devnet' ? 'devnet' : 'mainnet',
            ...(wallet ? { wallet } : {}),
          },
        },
      };

      let message: LanaMessage;
      try {
        message = await lanaRequest<LanaMessage>(body, ctx, cancellation(extra));
      } catch (err) {
        return handleToolError(err, 'Lana request failed', lanaErrorHandlers(model));
      }

      if (message.stop_reason === 'error') return failedTurn(message, model);

      const answer = answerText(message);
      if (!answer) {
        const recovery = 'Rephrase the question and try again.';
        return lanaError(
          `Lana finished without an answer. This request was still charged ${credits(model)}.\n\n${recovery}`,
          { type: 'API', code: 'LANA_EMPTY_ANSWER', retryable: false, recovery },
        );
      }

      return mcpText(`${attribution(message, model)}\n\n${answer}`);
    },
  );
}
