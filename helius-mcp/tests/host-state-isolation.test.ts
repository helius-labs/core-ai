import { describe, it, expect, vi, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * A fully provisioned host, built on disk rather than mocked.
 *
 * `config.ts` resolves its paths from `os.homedir()` at module load, and
 * `getJwt` calls its own module-local `loadConfig`, so mocking either export
 * leaves the real code path untouched — an earlier version of this file did
 * exactly that and asserted nothing on a machine that had never run `signup`.
 * Pointing `homedir` at a temp directory makes the real loader read a real
 * session, on any machine.
 */
const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'helius-host-state-'));
fs.mkdirSync(path.join(HOME, '.helius'), { recursive: true });
fs.writeFileSync(
  path.join(HOME, '.helius', 'config.json'),
  JSON.stringify({ jwt: 'host-dashboard-session-token', apiKey: 'host-operator-key-0000' }),
);
fs.writeFileSync(path.join(HOME, '.helius', 'keypair.json'), '[1,2,3]');

vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>();
  return { ...actual, default: { ...actual, homedir: () => HOME }, homedir: () => HOME };
});

const { callActionHandler } = await import('../src/router/action-handlers.js');

const CALLER = { authInfo: { token: 'caller-key-aaaa1111', extra: { network: 'mainnet-beta' } } };

async function textFor(action: string, params: Record<string, unknown>, extra: unknown) {
  const result = await callActionHandler(action as never, params, extra);
  return result.content?.[0]?.text ?? '';
}

afterAll(() => {
  fs.rmSync(HOME, { recursive: true, force: true });
});

/**
 * A request that carried its own identity must not be answered with state
 * belonging to this host — the dashboard session, the keypair on disk, the
 * session wallet. The failure is quiet: the caller authenticates, the response
 * looks right, and the data is the operator's.
 *
 * The other suites cannot see this. They mock the resolvers, so a handler
 * reading host state still returns plausible output.
 */

describe('the host fixture is provisioned', () => {
  it('answers a local caller with the session and keypair', async () => {
    // Guards the guards. If this stops passing, the fixture has stopped being
    // set up and every assertion below would pass for the wrong reason.
    const text = await textFor('getStarted', {}, {});
    expect(text).toMatch(/all set|account session are configured/i);
  });
});

describe('host state is withheld from an identified caller', () => {
  it('getStarted does not report the host dashboard session', async () => {
    expect(await textFor('getStarted', {}, CALLER))
      .not.toMatch(/all set|account session are configured/i);
  });

  it('getStarted does not reveal the host keypair', async () => {
    const text = await textFor('getStarted', {}, CALLER);
    expect(text).not.toContain(HOME);
    expect(text).not.toMatch(/keypair already exists/i);
  });

  it('refuses to sign with the host wallet', async () => {
    // The signer gate used to key only on HELIUS_MCP_SHARED_CREDENTIAL, so a
    // deployment authenticating per request without that flag would have signed
    // every caller's transaction with the operator's keypair — which the
    // fixture above puts on disk.
    const text = await textFor(
      'transferSol',
      { recipientAddress: 'So11111111111111111111111111111111111111112', amount: 0.001 },
      CALLER,
    );
    expect(text).toMatch(/unavailable on this server|holds no wallet/i);
  });

  it('getStakeAccounts asks for an address instead of using the host wallet', async () => {
    const text = await textFor('getStakeAccounts', {}, CALLER);
    expect(text).toMatch(/pass a wallet address/i);
    expect(text).not.toMatch(/generateKeypair/i);
  });
});
