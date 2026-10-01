import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { getOwsSolanaAddress } from '../src/utils/ows.js';
import { setNetwork } from '../src/utils/helius.js';

// Hoisted with the mock factories: `ows.ts` calls promisify at module scope, so
// a plain const would still be in its temporal dead zone when the import runs.
const { execFileAsync } = vi.hoisted(() => ({ execFileAsync: vi.fn() }));

vi.mock('node:child_process', () => ({ execFile: vi.fn() }));
// Spread the real module: replacing it wholesale breaks as soon as anything in
// this import graph reaches for `inspect` or `format`, with an error that
// points nowhere near the cause.
vi.mock('node:util', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:util')>()),
  promisify: () => execFileAsync,
}));

const MAINNET_CAIP2 = 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp';
const DEVNET_CAIP2 = 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG';

const MAINNET_ADDRESS = 'MainnetAddr1111111111111111111111111111111';
const DEVNET_ADDRESS = 'DevnetAddr22222222222222222222222222222222';

/**
 * `getOwsSolanaAddress` picks a CAIP-2 chain key from the network, then reads
 * the matching account out of the CLI's output. Wrong network, wrong key,
 * wrong address — silently, since both are well-formed.
 */
function walletInfoWithBothChains() {
  return {
    stdout: JSON.stringify({
      accounts: {
        [MAINNET_CAIP2]: MAINNET_ADDRESS,
        [DEVNET_CAIP2]: DEVNET_ADDRESS,
      },
    }),
  };
}

describe('OWS address resolution follows the request network', () => {
  const originalNetwork = process.env.HELIUS_NETWORK;

  beforeEach(() => {
    execFileAsync.mockReset();
    execFileAsync.mockResolvedValue(walletInfoWithBothChains());
    delete process.env.HELIUS_NETWORK;
  });

  afterEach(() => {
    if (originalNetwork === undefined) delete process.env.HELIUS_NETWORK;
    else process.env.HELIUS_NETWORK = originalNetwork;
  });

  it('picks the devnet account for a devnet caller', async () => {
    const address = await getOwsSolanaAddress('my-wallet', {
      apiKey: 'caller-key',
      network: 'devnet',
      sessionKey: 'sk',
    });
    expect(address).toBe(DEVNET_ADDRESS);
  });

  it('picks the mainnet account for a mainnet caller', async () => {
    const address = await getOwsSolanaAddress('my-wallet', {
      apiKey: 'caller-key',
      network: 'mainnet-beta',
      sessionKey: 'sk',
    });
    expect(address).toBe(MAINNET_ADDRESS);
  });

  it('follows the request even when the session defaults the other way', async () => {
    // The bug this closes: a devnet caller on a mainnet-default server used to
    // derive the mainnet address, because the network came from module state.
    process.env.HELIUS_NETWORK = 'mainnet-beta';
    const address = await getOwsSolanaAddress('my-wallet', {
      apiKey: 'caller-key',
      network: 'devnet',
      sessionKey: 'sk',
    });
    expect(address).toBe(DEVNET_ADDRESS);
  });

  it('falls back to HELIUS_NETWORK with no context', async () => {
    process.env.HELIUS_NETWORK = 'devnet';
    expect(await getOwsSolanaAddress('my-wallet')).toBe(DEVNET_ADDRESS);

    process.env.HELIUS_NETWORK = 'mainnet-beta';
    expect(await getOwsSolanaAddress('my-wallet')).toBe(MAINNET_ADDRESS);
  });

  it('falls back to the session network when the environment is unset', async () => {
    // Resolution is env first, then session, so the session branch is only
    // reachable with HELIUS_NETWORK cleared.
    delete process.env.HELIUS_NETWORK;
    setNetwork('devnet');
    try {
      expect(await getOwsSolanaAddress('my-wallet')).toBe(DEVNET_ADDRESS);
    } finally {
      setNetwork('mainnet-beta');
    }
  });
});
