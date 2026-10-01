import { describe, it, expect, vi } from 'vitest';

// The host is made to look fully provisioned: a dashboard session and a keypair
// on disk. Without this the assertions below pass vacuously on any machine that
// has never run `signup`, which is most of them — including CI.
//
// `loadConfig` is mocked rather than `getJwt`, deliberately. Stubbing `getJwt`
// would replace the very guard under test, and the suite would pass whether or
// not the context is honoured.
vi.mock('../src/utils/config.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/utils/config.js')>();
  return {
    ...actual,
    loadConfig: vi.fn(() => ({ jwt: 'host-dashboard-session-token' })),
    keypairExistsOnDisk: vi.fn(() => true),
    KEYPAIR_PATH: '/home/operator/.helius/keypair.json',
  };
});

import { callActionHandler } from '../src/router/action-handlers.js';

const CALLER = { authInfo: { token: 'caller-key-aaaa1111', extra: { network: 'mainnet-beta' } } };

/**
 * A request that carried its own identity must not be answered with state
 * belonging to this host — the dashboard session, the keypair on disk, the
 * session wallet. The failure is quiet: the caller authenticates, the response
 * looks right, and the data is the operator's.
 *
 * The other suites cannot see this. They mock the resolvers, so a handler
 * reading host state still returns plausible output.
 */

async function textFor(action: string, params: Record<string, unknown>, extra: unknown) {
  const result = await callActionHandler(action as never, params, extra);
  return result.content?.[0]?.text ?? '';
}

describe('host state is withheld from an identified caller', () => {
  it('getStarted does not report the host dashboard session', async () => {
    // The provisioned host would otherwise reach the "already set up" branch,
    // which is only true of the operator.
    expect(await textFor('getStarted', {}, CALLER)).not.toMatch(/all set|account session are configured/i);
  });

  it('getStarted does not reveal the host keypair', async () => {
    const text = await textFor('getStarted', {}, CALLER);
    expect(text).not.toContain('/home/operator/.helius/keypair.json');
    expect(text).not.toMatch(/keypair already exists/i);
  });

  it('getStakeAccounts asks for an address instead of using the host wallet', async () => {
    const text = await textFor('getStakeAccounts', {}, CALLER);
    expect(text).toMatch(/pass a wallet address/i);
    expect(text).not.toMatch(/generateKeypair/i);
  });
});

describe('signing with the host wallet is refused', () => {
  it('refuses a transfer when the request carried its own identity', async () => {
    // The signer gate used to key only on HELIUS_MCP_SHARED_CREDENTIAL, so a
    // deployment authenticating per request without that flag would have signed
    // every caller's transaction with the operator's keypair.
    const text = await textFor(
      'transferSol',
      { recipientAddress: 'So11111111111111111111111111111111111111112', amount: 0.001 },
      CALLER,
    );
    expect(text).toMatch(/unavailable on this server|holds no wallet/i);
  });
});

describe('the same host state still answers a local caller', () => {
  it('getStarted reports the session and keypair with no context', async () => {
    // The mirror of the above: withholding must be conditional on identity, not
    // a blanket removal that breaks the stdio build.
    const text = await textFor('getStarted', {}, {});
    expect(text).toMatch(/all set|account session are configured/i);
  });
});
