// ─── MCP Response Builders ───

type McpToolResponse = {
  content: [{ type: 'text'; text: string }];
  isError?: boolean;
};

export function mcpText(text: string): McpToolResponse {
  return { content: [{ type: 'text', text }] };
}

export function mcpError(text: string): McpToolResponse {
  return { content: [{ type: 'text', text }], isError: true };
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
    return mcpText(`**${context}**\n\nInvalid ${fieldName} "${value}". Valid options: ${validOptions.join(', ')}`);
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
    return mcpError(`**${fallbackPrefix}:** ${msg}\n\n${guidance}`);
  }
  return mcpError(`**${fallbackPrefix}:** ${msg}`);
}

// ─── Pre-built Handler Factories ───

export function addressError(header: string, detail?: string): ErrorHandler {
  return {
    match: isAddressError,
    respond: () => mcpText(`**${header}**\n\n${detail || 'Invalid Solana address. Please provide a valid base58-encoded address.'}`),
  };
}

export function paginationError(header: string, detail?: string): ErrorHandler {
  return {
    match: isPaginationError,
    respond: () => mcpText(`**${header}**\n\n${detail || 'Invalid pagination parameters. Page must be at least 1 and limit must be between 1 and 1000.'}`),
  };
}

export function notFoundError(header: string, detail?: string): ErrorHandler {
  return {
    match: isNotFoundError,
    respond: () => mcpText(`**${header}**\n\n${detail || 'Asset not found. This mint address does not exist or has not been indexed.'}`),
  };
}

export function http404Error(header: string, detail: string): ErrorHandler {
  return {
    match: isHttp404Error,
    respond: () => header ? mcpText(`**${header}**\n\n${detail}`) : mcpText(detail),
  };
}

export function http400Error(header: string): ErrorHandler {
  return {
    match: isHttp400Error,
    respond: (msg) => {
      const messages = parseHttp400Messages(msg);
      if (messages) {
        return mcpText(`**${header}**\n\n${messages.map((m: string) => `- ${m}`).join('\n')}`);
      }
      return mcpError(`**${header}:** ${msg}`);
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

export type { ErrorHandler, McpToolResponse };
