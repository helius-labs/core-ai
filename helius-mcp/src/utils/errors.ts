// ─── MCP Response Builders ───

type McpToolResponse = {
  content: [{ type: 'text'; text: string }];
  isError?: boolean;
};

export type ErrorMeta = {
  type: 'VALIDATION' | 'NOT_FOUND' | 'AUTH' | 'RATE_LIMIT' | 'INSUFFICIENT_FUNDS' | 'UNSUPPORTED' | 'HTTP' | 'API';
  code: string;
  retryable: boolean;
  recovery: string;
};

export function mcpText(text: string): McpToolResponse {
  return { content: [{ type: 'text', text }] };
}

export function mcpError(text: string, meta?: ErrorMeta): McpToolResponse {
  const body = meta
    ? '```json\n' + JSON.stringify(meta) + '\n```\n\n' + text
    : text;
  return { content: [{ type: 'text', text: body }], isError: true };
}

// ─── Error Message Extraction ───

export function getErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// ─── Error Classifiers ───

export function isAddressError(msg: string): boolean {
  return msg.includes('Pubkey Validation Err')
    || msg.includes('Invalid param')
    || msg.includes('Invalid pubkey')
    || msg.includes('Validation Error');
}

export function isPaginationError(msg: string): boolean {
  return msg.includes('Pagination Error')
    || msg.includes('invalid value')
    || msg.includes('expected u32')
    || msg.includes('expected u64');
}

export function isNotFoundError(msg: string): boolean {
  return msg.includes('RecordNotFound')
    || msg.includes('Asset Not Found')
    || msg.includes('Asset Proof Not Found');
}

export function isHttp404Error(msg: string): boolean {
  return msg.includes('404')
    || msg.includes('not found')
    || msg.includes('Method not found');
}

export function isHttp400Error(msg: string): boolean {
  return msg.includes('400');
}

export function parseHttp400Messages(msg: string): string[] | null {
  try {
    const json = JSON.parse(msg.replace(/^HTTP 400:\s*/, ''));
    const messages = Array.isArray(json.message) ? json.message : [json.message];
    return messages;
  } catch {
    return null;
  }
}

// ─── Enum Validation ───

export function validateEnum(
  value: string,
  validOptions: readonly string[],
  context: string,
  fieldName: string
): McpToolResponse | null {
  if (!validOptions.includes(value)) {
    return mcpError(
      `**${context}**\n\nInvalid ${fieldName} "${value}". Valid options: ${validOptions.join(', ')}`,
      { type: 'VALIDATION', code: 'INVALID_ENUM', retryable: false, recovery: `Use one of: ${validOptions.join(', ')}` }
    );
  }
  return null;
}

// ─── HTTP Status Guidance ───

const HTTP_GUIDANCE: Record<string, string> = {
  '401': 'API key is invalid or expired. Call `setHeliusApiKey` with a valid key, or call `getAccountStatus` to check your current auth state.',
  '403': 'This endpoint is restricted on your current plan. Call `getAccountStatus` to check your plan tier and remaining credits. Some endpoints (Enhanced Transactions, Token API) require Developer plan or higher. Call `getHeliusPlanInfo` to compare plans, or `previewUpgrade` to see upgrade pricing.',
  '429': 'Rate limited. Call `getAccountStatus` to check your remaining credits and rate limits. Back off and retry, or call `previewUpgrade` to see upgrade options for higher limits.',
  '502': 'Backend temporarily unavailable. Retry after a few seconds.',
  '504': 'Gateway timeout — the request took too long. Try reducing the query scope (fewer addresses, smaller limit, narrower time range).',
};

function extractHttpGuidance(msg: string): string | null {
  for (const [status, guidance] of Object.entries(HTTP_GUIDANCE)) {
    if (msg.includes(`HTTP ${status}`) || msg.includes(`status: ${status}`) || msg.includes(`(${status})`)) {
      return guidance;
    }
  }
  return null;
}

const HTTP_META: Record<string, ErrorMeta> = {
  '401': { type: 'AUTH', code: 'HTTP_401', retryable: false, recovery: HTTP_GUIDANCE['401'] },
  '403': { type: 'AUTH', code: 'HTTP_403', retryable: false, recovery: HTTP_GUIDANCE['403'] },
  '429': { type: 'RATE_LIMIT', code: 'HTTP_429', retryable: true, recovery: HTTP_GUIDANCE['429'] },
  '502': { type: 'HTTP', code: 'HTTP_502', retryable: true, recovery: HTTP_GUIDANCE['502'] },
  '504': { type: 'HTTP', code: 'HTTP_504', retryable: true, recovery: HTTP_GUIDANCE['504'] },
};

function extractHttpMeta(msg: string, _guidance: string): ErrorMeta {
  for (const [status, meta] of Object.entries(HTTP_META)) {
    if (msg.includes(`HTTP ${status}`) || msg.includes(`status: ${status}`) || msg.includes(`(${status})`)) {
      return meta;
    }
  }
  return { type: 'API', code: 'UNKNOWN', retryable: false, recovery: 'Check the error message for details' };
}

// ─── Catch-Block Handler Chain ───

type ErrorHandler = {
  match: (msg: string) => boolean;
  respond: (msg: string) => McpToolResponse;
};

export function handleToolError(
  err: unknown,
  fallbackPrefix: string,
  handlers?: ErrorHandler[]
): McpToolResponse {
  const msg = getErrorMessage(err);
  if (handlers) {
    for (const handler of handlers) {
      if (handler.match(msg)) return handler.respond(msg);
    }
  }
  const guidance = extractHttpGuidance(msg);
  if (guidance) {
    const meta = extractHttpMeta(msg, guidance);
    return mcpError(`**${fallbackPrefix}:** ${msg}\n\n${guidance}`, meta);
  }
  return mcpError(`**${fallbackPrefix}:** ${msg}`, { type: 'API', code: 'UNKNOWN', retryable: false, recovery: 'Check the error message for details' });
}

// ─── Pre-built Handler Factories ───

export function addressError(header: string, detail?: string): ErrorHandler {
  const recovery = detail || 'Invalid Solana address. Please provide a valid base58-encoded address.';
  return {
    match: isAddressError,
    respond: () => mcpError(
      `**${header}**\n\n${recovery}`,
      { type: 'VALIDATION', code: 'INVALID_ADDRESS', retryable: false, recovery }
    ),
  };
}

export function paginationError(header: string, detail?: string): ErrorHandler {
  const recovery = detail || 'Invalid pagination parameters. Page must be at least 1 and limit must be between 1 and 1000.';
  return {
    match: isPaginationError,
    respond: () => mcpError(
      `**${header}**\n\n${recovery}`,
      { type: 'VALIDATION', code: 'INVALID_PAGINATION', retryable: false, recovery }
    ),
  };
}

export function notFoundError(header: string, detail?: string): ErrorHandler {
  const recovery = detail || 'Asset not found. This mint address does not exist or has not been indexed.';
  return {
    match: isNotFoundError,
    respond: () => mcpError(
      `**${header}**\n\n${recovery}`,
      { type: 'NOT_FOUND', code: 'RESOURCE_NOT_FOUND', retryable: false, recovery }
    ),
  };
}

export function http404Error(header: string, detail: string): ErrorHandler {
  return {
    match: isHttp404Error,
    respond: () => mcpError(
      header ? `**${header}**\n\n${detail}` : detail,
      { type: 'NOT_FOUND', code: 'HTTP_404', retryable: false, recovery: detail }
    ),
  };
}

export function http400Error(header: string): ErrorHandler {
  return {
    match: isHttp400Error,
    respond: (msg) => {
      const messages = parseHttp400Messages(msg);
      if (messages) {
        return mcpError(
          `**${header}**\n\n${messages.map((m: string) => `- ${m}`).join('\n')}`,
          { type: 'API', code: 'BAD_REQUEST', retryable: false, recovery: 'Fix the request parameters' }
        );
      }
      return mcpError(
        `**${header}:** ${msg}`,
        { type: 'API', code: 'BAD_REQUEST', retryable: false, recovery: 'Fix the request parameters' }
      );
    },
  };
}

// ─── Address Format Validation (for config-generation warnings) ───

const SOLANA_ADDRESS_REGEX = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export function isValidAddressFormat(address: string): boolean {
  return SOLANA_ADDRESS_REGEX.test(address);
}

export function warnInvalidAddresses(paramName: string, addresses: string[]): string[] {
  const warnings: string[] = [];
  const empty = addresses.filter(a => !a || !a.trim());
  if (empty.length > 0) {
    warnings.push(`${paramName} contains ${empty.length} empty/blank address(es). These will be rejected by the endpoint.`);
  }
  const invalid = addresses.filter(a => a && a.trim() && !isValidAddressFormat(a.trim()));
  if (invalid.length > 0) {
    warnings.push(`${paramName} contains ${invalid.length} address(es) with invalid format: ${invalid.slice(0, 3).map(a => `"${a}"`).join(', ')}${invalid.length > 3 ? `, ... (${invalid.length} total)` : ''}. Solana addresses are 32-44 base58 characters.`);
  }
  return warnings;
}

export function warnInvalidAddress(paramName: string, address: string): string | null {
  if (!address || !address.trim()) {
    return `${paramName} is empty/blank. A valid Solana address is required.`;
  }
  if (!isValidAddressFormat(address.trim())) {
    return `${paramName} "${address}" does not look like a valid Solana address (expected 32-44 base58 characters).`;
  }
  return null;
}

export function warnAddressConflicts(
  includeName: string, includeAddresses: string[] | undefined,
  excludeName: string, excludeAddresses: string[] | undefined
): string | null {
  if (!includeAddresses || !excludeAddresses) return null;
  const includeSet = new Set(includeAddresses.map(a => a.trim()));
  const overlap = excludeAddresses.filter(a => includeSet.has(a.trim()));
  if (overlap.length > 0) {
    return `${overlap.length} address(es) appear in both ${includeName} and ${excludeName}: ${overlap.slice(0, 3).map(a => `"${a}"`).join(', ')}${overlap.length > 3 ? `, ... (${overlap.length} total)` : ''}. These addresses will be included and excluded simultaneously, which may cause unexpected behavior.`;
  }
  return null;
}

// ─── Convenience Error Helpers ───

export function missingParamError(toolName: string, recovery: string): McpToolResponse {
  return mcpError(
    `**${toolName} Error**\n\n${recovery}`,
    { type: 'VALIDATION', code: 'MISSING_PARAM', retryable: false, recovery }
  );
}

export function exclusiveParamError(toolName: string, paramA: string, paramB: string): McpToolResponse {
  const recovery = `Provide either \`${paramA}\` or \`${paramB}\`, not both.`;
  return mcpError(
    `**${toolName} Error**\n\n${recovery}`,
    { type: 'VALIDATION', code: 'EXCLUSIVE_PARAMS', retryable: false, recovery }
  );
}

export function batchLimitError(toolName: string, max: number, actual: number): McpToolResponse {
  const recovery = `Reduce batch to ${max} or fewer items.`;
  return mcpError(
    `**${toolName} Error**\n\nMaximum ${max} items per request. You provided ${actual}.`,
    { type: 'VALIDATION', code: 'TOO_MANY_ITEMS', retryable: false, recovery }
  );
}

export type { ErrorHandler, McpToolResponse };
