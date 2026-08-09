import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { registerSecret, clearRegisteredSecrets, redactSecrets } from '../src/utils/redact.js';
import { isSharedCredentialMode } from '../src/utils/runtime.js';

const KEY = 'b1f3c9de-4a77-4a2f-9d0e-2c6f8a1b5e44';

function shared(): void {
  process.env.HELIUS_MCP_SHARED_CREDENTIAL = '1';
}

beforeEach(() => {
  clearRegisteredSecrets();
  delete process.env.HELIUS_MCP_SHARED_CREDENTIAL;
});

afterEach(() => {
  clearRegisteredSecrets();
  delete process.env.HELIUS_MCP_SHARED_CREDENTIAL;
});

// ─── Mode Detection ───────────────────────────────────────────────────────────

describe('isSharedCredentialMode', () => {
  it('is off by default so the stdio build is unaffected', () => {
    expect(isSharedCredentialMode()).toBe(false);
  });

  it('accepts "1" and "true"', () => {
    process.env.HELIUS_MCP_SHARED_CREDENTIAL = '1';
    expect(isSharedCredentialMode()).toBe(true);
    process.env.HELIUS_MCP_SHARED_CREDENTIAL = 'true';
    expect(isSharedCredentialMode()).toBe(true);
  });

  it('ignores other values', () => {
    process.env.HELIUS_MCP_SHARED_CREDENTIAL = 'no';
    expect(isSharedCredentialMode()).toBe(false);
  });
});

// ─── Single-Tenant Passthrough ────────────────────────────────────────────────

describe('redactSecrets outside shared-credential mode', () => {
  it('leaves a registered key untouched', () => {
    registerSecret(KEY);
    expect(redactSecrets(`key is ${KEY}`)).toBe(`key is ${KEY}`);
  });

  it('leaves a WebSocket URL usable', () => {
    const url = `wss://atlas-mainnet.helius-rpc.com/?api-key=${KEY}`;
    expect(redactSecrets(url)).toBe(url);
  });
});

// ─── Shared-Credential Redaction ──────────────────────────────────────────────

describe('redactSecrets in shared-credential mode', () => {
  it('redacts a registered key', () => {
    shared();
    registerSecret(KEY);
    const out = redactSecrets(`key is ${KEY}`);
    expect(out).not.toContain(KEY);
    expect(out).toContain('***REDACTED***');
  });

  it('redacts every occurrence', () => {
    shared();
    registerSecret(KEY);
    const out = redactSecrets(`${KEY} and again ${KEY}`);
    expect(out).not.toContain(KEY);
  });

  it('redacts an api-key query param even when the key was never registered', () => {
    shared();
    const out = redactSecrets(`https://api.helius.xyz/v0/addresses/x?api-key=${KEY}`);
    expect(out).not.toContain(KEY);
    expect(out).toContain('api-key=***REDACTED***');
  });

  it('redacts a key in a ws URL and keeps the host readable', () => {
    shared();
    registerSecret(KEY);
    const out = redactSecrets(`wss://atlas-mainnet.helius-rpc.com/?api-key=${KEY}`);
    expect(out).not.toContain(KEY);
    expect(out).toContain('atlas-mainnet.helius-rpc.com');
  });

  it('stops at the next query param rather than eating the rest of the URL', () => {
    shared();
    const out = redactSecrets(`https://api.helius.xyz/v0/x?api-key=${KEY}&limit=10`);
    expect(out).not.toContain(KEY);
    expect(out).toContain('&limit=10');
  });

  it('stops at a closing backtick in fenced output', () => {
    shared();
    const out = redactSecrets(`\`https://api.helius.xyz/x?api-key=${KEY}\` then prose`);
    expect(out).not.toContain(KEY);
    expect(out).toContain('` then prose');
  });

  it('leaves text without secrets unchanged', () => {
    shared();
    registerSecret(KEY);
    const text = '## Balance\n\n**SOL:** 1.234';
    expect(redactSecrets(text)).toBe(text);
  });

  it('ignores short or empty values so ordinary text survives', () => {
    shared();
    registerSecret('');
    registerSecret('abc');
    const text = 'abc is a common substring';
    expect(redactSecrets(text)).toBe(text);
  });
});
