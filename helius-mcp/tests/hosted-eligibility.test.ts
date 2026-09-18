import { describe, it, expect } from 'vitest';

import {
  ACTION_CATALOG,
  hostedEligible,
  getHostedActions,
  HOSTED_ACTION_COUNT,
} from '../src/router/catalog.js';

/**
 * A hosted deployment is multi-tenant and holds no wallet, no dashboard JWT and
 * no on-disk config. These tests pin the boundary, because widening it silently
 * is how a hosted server ends up signing on someone's behalf.
 */

describe('hostedEligible', () => {
  it('admits actions that need only the caller API key', () => {
    expect(hostedEligible(ACTION_CATALOG.getTokenBalances)).toBe(true);
  });

  it('admits actions that need no credential at all', () => {
    expect(hostedEligible(ACTION_CATALOG.compareHeliusPlans)).toBe(true);
  });

  it('refuses every action that needs a signer', () => {
    for (const entry of Object.values(ACTION_CATALOG)) {
      if (entry.authRequirement === 'signer' || entry.authRequirement === 'jwtAndSigner') {
        expect(hostedEligible(entry)).toBe(false);
      }
    }
  });

  it('refuses every action that needs a dashboard JWT', () => {
    for (const entry of Object.values(ACTION_CATALOG)) {
      if (entry.authRequirement === 'jwt') {
        expect(hostedEligible(entry)).toBe(false);
      }
    }
  });

  it('refuses generateKeypair, which would return key material to the caller', () => {
    expect(ACTION_CATALOG.generateKeypair.authRequirement).toBe('none');
    expect(hostedEligible(ACTION_CATALOG.generateKeypair)).toBe(false);
  });

  it('refuses setHeliusApiKey, which mutates config for every caller', () => {
    expect(ACTION_CATALOG.setHeliusApiKey.authRequirement).toBe('none');
    expect(hostedEligible(ACTION_CATALOG.setHeliusApiKey)).toBe(false);
  });

  it('keeps webhook CRUD, which mutates but needs only the caller API key', () => {
    for (const action of ['createWebhook', 'updateWebhook', 'deleteWebhook'] as const) {
      expect(ACTION_CATALOG[action].mutability).toBe('write');
      expect(hostedEligible(ACTION_CATALOG[action])).toBe(true);
    }
  });
});

describe('mutability labels', () => {
  it('labels every mutation-receipt action a write', () => {
    for (const entry of Object.values(ACTION_CATALOG)) {
      if (entry.responseFamily === 'mutationReceipt') {
        expect(entry.mutability).toBe('write');
      }
    }
  });

  it('labels purchaseCredits a write, since it spends money', () => {
    expect(ACTION_CATALOG.purchaseCredits.mutability).toBe('write');
  });

  it('labels signup a write — under autopay it sends USDC from the local keypair', () => {
    expect(ACTION_CATALOG.signup.mutability).toBe('write');
  });

  it('labels setHeliusApiKey a write, since it changes server config', () => {
    expect(ACTION_CATALOG.setHeliusApiKey.mutability).toBe('write');
  });

  it('labels every action that needs a signer a write', () => {
    // Acting as the wallet is a mutation wherever it appears. This is the
    // invariant that catches actions whose receipt shape looks like a read.
    for (const entry of Object.values(ACTION_CATALOG)) {
      if (entry.authRequirement === 'signer' || entry.authRequirement === 'jwtAndSigner') {
        expect(entry.mutability).toBe('write');
      }
    }
  });

  it('defaults to read rather than inferring from the public tool name', () => {
    expect(ACTION_CATALOG.getBalance.mutability).toBe('read');
  });
});

describe('the hosted surface', () => {
  it('matches the declared hosted action count', () => {
    expect(Object.keys(ACTION_CATALOG)).toHaveLength(95);
    expect(getHostedActions()).toHaveLength(HOSTED_ACTION_COUNT);
  });

  it('excludes every heliusWrite action', () => {
    const hosted = new Set(getHostedActions());
    for (const entry of Object.values(ACTION_CATALOG)) {
      if (entry.publicTool === 'heliusWrite') {
        expect(hosted.has(entry.action)).toBe(false);
      }
    }
  });
});
