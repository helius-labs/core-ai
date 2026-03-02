import { describe, it, expect } from 'vitest';
import {
  mcpText,
  mcpError,
  getErrorMessage,
  isAddressError,
  isPaginationError,
  isNotFoundError,
  isHttp404Error,
  isHttp400Error,
  parseHttp400Messages,
  validateEnum,
  handleToolError,
  addressError,
  paginationError,
  notFoundError,
  isValidAddressFormat,
  warnInvalidAddresses,
  warnInvalidAddress,
  warnAddressConflicts,
} from '../src/utils/errors.js';

// ─── Response Builders ───

describe('mcpText', () => {
  it('returns correct MCP text response shape', () => {
    const result = mcpText('hello world');
    expect(result).toEqual({ content: [{ type: 'text', text: 'hello world' }] });
  });

  it('does not set isError', () => {
    expect(mcpText('msg').isError).toBeUndefined();
  });
});

describe('mcpError', () => {
  it('returns correct MCP error response shape', () => {
    const result = mcpError('something went wrong');
    expect(result).toEqual({ content: [{ type: 'text', text: 'something went wrong' }], isError: true });
  });
});

// ─── Error Message Extraction ───

describe('getErrorMessage', () => {
  it('returns message from Error instances', () => {
    expect(getErrorMessage(new Error('boom'))).toBe('boom');
  });

  it('coerces non-Error values to string', () => {
    expect(getErrorMessage('raw string')).toBe('raw string');
    expect(getErrorMessage(42)).toBe('42');
    expect(getErrorMessage({ msg: 'obj' })).toBe('[object Object]');
  });
});

// ─── Error Classifiers ───

describe('isAddressError', () => {
  it.each([
    'Pubkey Validation Err: invalid base58',
    'Invalid param: address',
    'Invalid pubkey format',
    'Validation Error occurred',
  ])('returns true for: %s', (msg) => {
    expect(isAddressError(msg)).toBe(true);
  });

  it('returns false for unrelated errors', () => {
    expect(isAddressError('Internal server error')).toBe(false);
    expect(isAddressError('Not found')).toBe(false);
  });
});

describe('isPaginationError', () => {
  it.each([
    'Pagination Error: page out of range',
    'invalid value for page',
    'expected u32 but got -1',
    'expected u64, found string',
  ])('returns true for: %s', (msg) => {
    expect(isPaginationError(msg)).toBe(true);
  });

  it('returns false for unrelated errors', () => {
    expect(isPaginationError('record not found')).toBe(false);
  });
});

describe('isNotFoundError', () => {
  it.each([
    'RecordNotFound',
    'Asset Not Found',
    'Asset Proof Not Found',
  ])('returns true for: %s', (msg) => {
    expect(isNotFoundError(msg)).toBe(true);
  });

  it('returns false for unrelated errors', () => {
    expect(isNotFoundError('Invalid address')).toBe(false);
  });
});

describe('isHttp404Error', () => {
  it.each(['404 Not Found', 'resource not found', 'Method not found'])('returns true for: %s', (msg) => {
    expect(isHttp404Error(msg)).toBe(true);
  });

  it('returns false for unrelated errors', () => {
    expect(isHttp404Error('500 Internal Server Error')).toBe(false);
  });
});

describe('isHttp400Error', () => {
  it('returns true when message contains "400"', () => {
    expect(isHttp400Error('HTTP 400: Bad Request')).toBe(true);
  });

  it('returns false for other status codes', () => {
    expect(isHttp400Error('HTTP 500: Internal Server Error')).toBe(false);
  });
});

// ─── HTTP 400 Message Parser ───

describe('parseHttp400Messages', () => {
  it('parses array messages', () => {
    const msg = 'HTTP 400: {"message":["field is required","value too long"]}';
    expect(parseHttp400Messages(msg)).toEqual(['field is required', 'value too long']);
  });

  it('wraps a single string message in an array', () => {
    const msg = 'HTTP 400: {"message":"bad input"}';
    expect(parseHttp400Messages(msg)).toEqual(['bad input']);
  });

  it('returns null for non-JSON messages', () => {
    expect(parseHttp400Messages('HTTP 400: plain text error')).toBeNull();
  });
});

// ─── Enum Validation ───

describe('validateEnum', () => {
  it('returns null for valid values', () => {
    expect(validateEnum('mainnet-beta', ['mainnet-beta', 'devnet'], 'Network', 'network')).toBeNull();
  });

  it('returns an error response for invalid values', () => {
    const result = validateEnum('testnet', ['mainnet-beta', 'devnet'], 'Network', 'network');
    expect(result).not.toBeNull();
    expect(result!.content[0].text).toContain('testnet');
    expect(result!.content[0].text).toContain('mainnet-beta');
  });
});

// ─── handleToolError ───

describe('handleToolError', () => {
  it('falls back to mcpError when no handlers match', () => {
    const result = handleToolError(new Error('unknown'), 'Test prefix');
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Test prefix');
    expect(result.content[0].text).toContain('unknown');
  });

  it('dispatches to the first matching handler', () => {
    const handler = addressError('My Tool');
    const result = handleToolError(new Error('Invalid pubkey format'), 'Fallback', [handler]);
    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain('My Tool');
  });

  it('skips non-matching handlers and falls back', () => {
    const handler = notFoundError('My Tool');
    const result = handleToolError(new Error('Invalid pubkey format'), 'Fallback', [handler]);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Fallback');
  });

  it('handles non-Error thrown values', () => {
    const result = handleToolError('string error', 'Prefix');
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('string error');
  });
});

// ─── Pre-built Handler Factories ───

describe('addressError factory', () => {
  it('matches address errors and responds with header', () => {
    const handler = addressError('Get Asset');
    expect(handler.match('Invalid pubkey format')).toBe(true);
    const response = handler.respond('Invalid pubkey format');
    expect(response.content[0].text).toContain('Get Asset');
  });

  it('uses custom detail when provided', () => {
    const handler = addressError('Get Asset', 'Custom detail message');
    const response = handler.respond('err');
    expect(response.content[0].text).toContain('Custom detail message');
  });
});

describe('paginationError factory', () => {
  it('matches pagination errors', () => {
    const handler = paginationError('My Tool');
    expect(handler.match('Pagination Error: page 0 invalid')).toBe(true);
    const response = handler.respond('Pagination Error');
    expect(response.content[0].text).toContain('My Tool');
  });
});

describe('notFoundError factory', () => {
  it('matches not-found errors', () => {
    const handler = notFoundError('My Tool');
    expect(handler.match('Asset Not Found')).toBe(true);
    const response = handler.respond('Asset Not Found');
    expect(response.content[0].text).toContain('My Tool');
  });
});

// ─── Address Format Validation ───

describe('isValidAddressFormat', () => {
  it('accepts valid Solana base58 addresses', () => {
    expect(isValidAddressFormat('11111111111111111111111111111111')).toBe(true);
    expect(isValidAddressFormat('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v')).toBe(true);
    expect(isValidAddressFormat('So11111111111111111111111111111111111111112')).toBe(true);
  });

  it('rejects empty strings', () => {
    expect(isValidAddressFormat('')).toBe(false);
  });

  it('rejects strings that are too short', () => {
    expect(isValidAddressFormat('abc123')).toBe(false);
  });

  it('rejects strings with invalid base58 characters', () => {
    expect(isValidAddressFormat('0OIl' + 'a'.repeat(28))).toBe(false); // 0, O, I, l are invalid in base58
  });
});

describe('warnInvalidAddresses', () => {
  it('returns no warnings for valid addresses', () => {
    const warnings = warnInvalidAddresses('accounts', [
      '11111111111111111111111111111111',
      'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    ]);
    expect(warnings).toHaveLength(0);
  });

  it('warns about empty/blank addresses', () => {
    const warnings = warnInvalidAddresses('accounts', ['', '  ']);
    expect(warnings[0]).toContain('2 empty/blank');
  });

  it('warns about invalid format addresses', () => {
    const warnings = warnInvalidAddresses('accounts', ['not-valid-base58!']);
    expect(warnings[0]).toContain('invalid format');
  });

  it('returns both warnings when both issues present', () => {
    const warnings = warnInvalidAddresses('accounts', ['', 'not-valid!']);
    expect(warnings).toHaveLength(2);
  });
});

describe('warnInvalidAddress', () => {
  it('returns null for a valid address', () => {
    expect(warnInvalidAddress('address', '11111111111111111111111111111111')).toBeNull();
  });

  it('returns a warning for an empty address', () => {
    const warning = warnInvalidAddress('address', '');
    expect(warning).toContain('empty/blank');
  });

  it('returns a warning for an invalid format address', () => {
    const warning = warnInvalidAddress('address', 'bad!address');
    expect(warning).toContain('does not look like a valid Solana address');
  });
});

describe('warnAddressConflicts', () => {
  it('returns null when there is no overlap', () => {
    const result = warnAddressConflicts(
      'include', ['aaaa11111111111111111111111111111111'],
      'exclude', ['bbbb11111111111111111111111111111111'],
    );
    expect(result).toBeNull();
  });

  it('returns a warning when addresses appear in both lists', () => {
    const addr = '11111111111111111111111111111111';
    const result = warnAddressConflicts('include', [addr], 'exclude', [addr]);
    expect(result).toContain('1 address(es) appear in both');
  });

  it('returns null when either list is undefined', () => {
    expect(warnAddressConflicts('include', undefined, 'exclude', ['addr'])).toBeNull();
    expect(warnAddressConflicts('include', ['addr'], 'exclude', undefined)).toBeNull();
  });
});
