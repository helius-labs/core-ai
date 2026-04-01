# Drift Strategy Vaults — Delegated Trading, Managed Funds

## What This Covers

Drift strategy vaults: managed trading funds where vault managers trade on behalf of depositors, performance fees, deposit/withdrawal mechanics, and vault creation.

**SDK**: `npm install @drift-labs/vaults-sdk` (separate from the core `@drift-labs/sdk`)

## How Vaults Work

A Drift vault is a managed trading account:
1. **Vault manager** creates a vault with a trading strategy and fee structure
2. **Depositors** deposit tokens (typically USDC) into the vault
3. **Manager trades** using the vault's pooled capital on Drift markets
4. **Profits are shared** based on depositor share, minus management/performance fees

The vault manager can trade perps and spot on Drift but cannot withdraw depositor funds directly. Smart contract enforces separation.

**Vaults Program**: `vAuLTsyrvSfZRuRB3XgvkPwNGgYSs9YRYymVebLKoxR`

## Setting Up VaultClient

The VaultClient requires an initialized DriftClient and the vaults Anchor program:

```typescript
import { VaultClient } from '@drift-labs/vaults-sdk';
import { DriftClient, BN, QUOTE_PRECISION } from '@drift-labs/sdk';
import { Program } from '@coral-xyz/anchor';

// driftClient must already be initialized and subscribed
const vaultClient = new VaultClient({
  driftClient,
  program: vaultProgram, // Anchor Program<DriftVaults> instance
});
```

The `vaultProgram` is an Anchor `Program` instance pointing to the Vaults program IDL. See the `@drift-labs/vaults-sdk` docs for full setup.

## Depositing into a Vault

First-time depositors must initialize their vault depositor account before depositing:

```typescript
import { getVaultDepositorAddressSync, VAULT_PROGRAM_ID } from '@drift-labs/vaults-sdk';

// Derive the depositor PDA
const vaultDepositor = getVaultDepositorAddressSync(
  VAULT_PROGRAM_ID, // vAuLTsyrvSfZRuRB3XgvkPwNGgYSs9YRYymVebLKoxR
  vaultAddress,
  wallet.publicKey
);

// First deposit: initialize the depositor account first
await vaultClient.initializeVaultDepositor(vaultAddress, wallet.publicKey);

// Then deposit
await vaultClient.deposit(
  vaultDepositor,
  new BN(1000).mul(QUOTE_PRECISION)
);
```

## Withdrawing from a Vault

```typescript
import { WithdrawUnit } from '@drift-labs/vaults-sdk';

// Request withdrawal (may have a waiting period)
await vaultClient.requestWithdraw(
  vaultDepositor,
  new BN(500).mul(QUOTE_PRECISION),
  WithdrawUnit.TOKEN
);

// After the redeem period passes, execute withdrawal
await vaultClient.withdraw(vaultDepositor);
```

Withdrawal mechanics depend on the vault's configuration:
- Some vaults have instant withdrawal
- Others have a cooldown period (e.g., 24 hours) to prevent front-running
- Withdrawals are limited by the vault's available liquidity (open positions may need to be closed first)

## Querying Vault Performance

```typescript
// Get vault account data
const vault = await vaultClient.getVault(vaultAddress);

const totalDeposits = convertToNumber(vault.totalDeposits, QUOTE_PRECISION);
const managerProfit = convertToNumber(vault.managerTotalProfitShare, QUOTE_PRECISION);
```

### Data API

```
GET https://data.api.drift.trade/authority/{vaultAuthority}/snapshots/overview
```

Returns historical PnL snapshots for the vault's trading account.

## Vault Fee Structure

Vault managers set fees at creation:

| Fee Type | Description | Typical Range |
|----------|-------------|---------------|
| Management fee | Annual fee on AUM | 0% to 2% |
| Performance fee | Share of profits | 10% to 30% |
| Profit share | Percentage of net gains | Configurable per vault |

Fees are calculated on-chain. Depositors see net returns after fees.

## Creating a Vault (Manager)

Vault creation requires the Anchor program and uses byte arrays for the name field:

```typescript
await vaultClient.initializeVault({
  name: Array.from(Buffer.from('My Strategy')), // must be number[] (byte array)
  spotMarketIndex: 0, // USDC as base asset
  redeemPeriod: new BN(86400), // 24h withdrawal cooldown in seconds
  maxTokens: new BN(1_000_000).mul(QUOTE_PRECISION), // $1M deposit cap
  minDepositAmount: new BN(1).mul(QUOTE_PRECISION), // $1 minimum deposit
  managementFee: new BN(200), // 2% annual (200 basis points)
  profitShare: 2000, // 20% of profits (2000 = 20%)
  hurdleRate: 0, // no hurdle rate
  permissioned: false, // anyone can deposit
});
```

## Key Considerations

- Vault depositors trust the manager's trading decisions — there is real risk of loss
- Manager cannot withdraw depositor funds, but can make trading decisions that lose money
- Performance fees only apply to net profits (high-water mark)
- Vault TVL and historical returns should be evaluated before depositing
- Browse available vaults at `https://app.drift.trade/vaults`
