import { describe, it, expect } from 'vitest';

import {
  ACTION_CATALOG,
  hostedEligible,
  getHostedActions,
  hostedExclusionReason,
} from '../src/router/catalog.js';
import { ACTION_NAMES } from '../src/router/actions.js';

/**
 * The hosted surface is the set of actions a multi-tenant deployment could
 * serve. Nothing consumes it yet — these tests fix the boundary before anything
 * depends on it, because widening it silently is how a hosted server ends up
 * signing or reading host state on someone's behalf.
 *
 * Catalog-wide invariants ("every mutation receipt is a write") live in
 * `pnpm validate`, which runs in the same `pnpm test`. This file keeps the
 * examples that explain *why* the boundary sits where it does.
 */

describe('the hosted surface', () => {
  it('is exactly this set', () => {
    // A snapshot rather than a count: swapping one action for another keeps a
    // count at 78 and passes, while this names both the entrant and the leaver
    // in the failing diff. Update deliberately, and say why in the PR.
    expect(getHostedActions()).toEqual([
      'accountSubscribe',
      'batchWalletIdentity',
      'createWebhook',
      'deleteWebhook',
      'fetchHeliusBlog',
      'getAccountInfo',
      'getAccountPlan',
      'getAllWebhooks',
      'getAsset',
      'getAssetProof',
      'getAssetProofBatch',
      'getAssetsByGroup',
      'getAssetsByOwner',
      'getBalance',
      'getBlock',
      'getCompressedAccount',
      'getCompressedAccountProof',
      'getCompressedAccountsByOwner',
      'getCompressedBalance',
      'getCompressedBalanceByOwner',
      'getCompressedMintTokenHolders',
      'getCompressedTokenAccountBalance',
      'getCompressedTokenAccountsByDelegate',
      'getCompressedTokenAccountsByOwner',
      'getCompressedTokenBalancesByOwnerV2',
      'getCompressionSignaturesForAccount',
      'getCompressionSignaturesForAddress',
      'getCompressionSignaturesForOwner',
      'getCompressionSignaturesForTokenOwner',
      'getEnhancedWebSocketInfo',
      'getHeliusCreditsInfo',
      'getIndexerHealth',
      'getIndexerSlot',
      'getLaserstreamInfo',
      'getLatencyComparison',
      'getLatestCompressionSignatures',
      'getLatestNonVotingSignatures',
      'getMultipleCompressedAccountProofs',
      'getMultipleCompressedAccounts',
      'getMultipleNewAddressProofs',
      'getNetworkStatus',
      'getNftEditions',
      'getPriorityFeeEstimate',
      'getProgramAccounts',
      'getPumpFunGuide',
      'getRateLimitInfo',
      'getSIMD',
      'getSenderInfo',
      'getSignaturesForAsset',
      'getStakeAccounts',
      'getTokenAccounts',
      'getTokenBalances',
      'getTokenHolders',
      'getTransactionHistory',
      'getTransactionWithCompressionInfo',
      'getTransfersByAddress',
      'getValidityProof',
      'getWalletBalanceAt',
      'getWalletBalances',
      'getWalletFundedBy',
      'getWalletHistory',
      'getWalletIdentity',
      'getWalletTransfers',
      'getWebhookByID',
      'getWebhookGuide',
      'getWithdrawableAmount',
      'laserstreamSubscribe',
      'listHeliusDocTopics',
      'listSIMDs',
      'lookupHeliusDocs',
      'parseTransactions',
      'readSolanaSourceFile',
      'searchAssets',
      'searchSolanaDocs',
      'simulateTransaction',
      'transactionSubscribe',
      'troubleshootError',
      'updateWebhook',
    ]);
  });

  it('covers the whole catalog between hosted and excluded', () => {
    const hosted = new Set(getHostedActions());
    const excluded = ACTION_NAMES.filter((a) => !hosted.has(a));
    expect(hosted.size + excluded.length).toBe(ACTION_NAMES.length);
  });
});

describe('what the boundary excludes, and why', () => {
  it('excludes every action needing a signer or a dashboard session', () => {
    for (const entry of Object.values(ACTION_CATALOG)) {
      if (entry.authRequirement === 'apiKey' || entry.authRequirement === 'none') continue;
      expect(hostedEligible(entry)).toBe(false);
    }
  });

  it('excludes actions whose credential is the caller\'s but whose effect is not', () => {
    // These pass the auth check and still have to go: `authRequirement`
    // describes what a call needs to authenticate, not what it reaches.
    for (const action of [
      'generateKeypair',
      'setHeliusApiKey',
      'recommendStack',
      'getStarted',
      'getHeliusPlanInfo',
      'compareHeliusPlans',
    ] as const) {
      expect(hostedExclusionReason(action)).toBeTruthy();
      expect(hostedEligible(ACTION_CATALOG[action])).toBe(false);
    }
  });

  it('gives every manual exclusion a stated reason', () => {
    for (const action of ACTION_NAMES) {
      const reason = hostedExclusionReason(action);
      if (reason !== undefined) expect(reason.length).toBeGreaterThan(20);
    }
  });
});

describe('what the boundary keeps', () => {
  it('keeps webhook CRUD, which mutates but needs only the caller API key', () => {
    // True of a deployment where each caller presents their own key. Under the
    // shared-credential mode that exists today, these would reach the
    // operator's webhooks — which is why nothing calls hostedEligible yet.
    for (const action of ['createWebhook', 'updateWebhook', 'deleteWebhook'] as const) {
      expect(ACTION_CATALOG[action].mutability).toBe('write');
      expect(hostedEligible(ACTION_CATALOG[action])).toBe(true);
    }
  });

  it('keeps ordinary reads that need nothing but a key', () => {
    expect(hostedEligible(ACTION_CATALOG.getTokenBalances)).toBe(true);
    expect(hostedEligible(ACTION_CATALOG.getBalance)).toBe(true);
  });
});

describe('mutability labels', () => {
  it('defaults to read rather than inferring from the public tool name', () => {
    expect(ACTION_CATALOG.getBalance.mutability).toBe('read');
  });

  it('labels signup a write — under autopay it sends USDC from the local keypair', () => {
    expect(ACTION_CATALOG.signup.mutability).toBe('write');
  });

  it('labels purchaseCredits a write, since it spends money', () => {
    expect(ACTION_CATALOG.purchaseCredits.mutability).toBe('write');
  });
});
