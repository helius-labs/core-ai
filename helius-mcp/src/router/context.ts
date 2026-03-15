import { randomUUID } from 'node:crypto';
import { getNetwork } from '../utils/helius.js';

const SESSION_KEY = randomUUID();

export type RouterContext = {
  sessionKey: string;
  network: 'mainnet-beta' | 'devnet';
};

export function getRouterContext(): RouterContext {
  const network = getNetwork();

  return {
    sessionKey: SESSION_KEY,
    network: network === 'devnet' ? 'devnet' : 'mainnet-beta',
  };
}
