import { PLAN_CATALOG } from "../lib/checkout.js";

// Valid plans for signup. `basic` was removed in favour of `agent` (10 USDC
// one-time with 1,000,000 starting credits). `agent` is the default entry
// plan for CLI signups and lives outside PLAN_CATALOG because it has no
// monthly/yearly price.
const SIGNUP_PLANS = new Set([...Object.keys(PLAN_CATALOG), "agent"]);
const UPGRADE_PLANS = new Set(Object.keys(PLAN_CATALOG));
const VALID_PERIODS = new Set(["monthly", "yearly"]);

// Base58 character set (no 0, O, I, l)
const BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

// Mirror of the wallet-api server's isValidDomainName so any input the server
// accepts (SNS .sol, ANS .bonk/.poor/etc., multi-label subdomains, underscores)
// passes client validation.
const DOMAIN_RE = /^[a-zA-Z0-9]([a-zA-Z0-9_-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]+)+$/;
const DOMAIN_MAX_LEN = 255;

export function validateSignupPlan(plan: string): string | null {
  if (!SIGNUP_PLANS.has(plan.toLowerCase())) {
    const available = [...SIGNUP_PLANS].join(", ");
    return `Unknown plan: ${plan}. Available: ${available}`;
  }
  return null;
}

export function validateUpgradePlan(plan: string): string | null {
  if (!UPGRADE_PLANS.has(plan.toLowerCase())) {
    const available = [...UPGRADE_PLANS].join(", ");
    return `Unknown plan: ${plan}. Available: ${available}`;
  }
  return null;
}

export function validatePeriod(period: string): string | null {
  if (!VALID_PERIODS.has(period.toLowerCase())) {
    return `Invalid billing period: ${period}. Must be "monthly" or "yearly".`;
  }
  return null;
}

// Prepaid-credits tiers advertised by the CLI. Only `10_USDC` is surfaced
// publicly; the SDK accepts any key in `stripe.prepaidCreditsPlans`
// (4_USDC / 5_USDC exist on the backend for legacy reasons) and future
// tiers can be passed as a raw `prepaid_credits_*` key or a bare
// `<N>_USDC` suffix without waiting for a CLI release.
//
// Canonical form uses uppercase `USDC` to match the backend lookup key
// (`stripe.prepaidCreditsPlans.prepaid_credits_10_USDC`). The validator
// accepts user input case-insensitively; callers should pass the result of
// `canonicalizeCreditsTier` to the SDK which prefixes it with
// `prepaid_credits_` internally.
const ADVERTISED_CREDITS_TIERS = new Set(["10_USDC"]);

/**
 * Shape of a tier suffix: a positive integer + `_USDC` (case-insensitive).
 * Accepts both the short form (`10_USDC`) and the full backend lookup key
 * (`prepaid_credits_10_USDC`). The full form is normalized to the short
 * form so the SDK's `prepaid_credits_${tier}` template matches the backend.
 */
const TIER_SUFFIX_RE = /^\d+_USDC$/i;
const TIER_FULL_KEY_RE = /^prepaid_credits_(\d+_USDC)$/i;

/**
 * Case-insensitive lookup that returns the canonical tier string
 * (uppercase `USDC`, short form — e.g. `10_USDC`). Accepts advertised
 * tiers, bare `<N>_USDC` suffixes, and full `prepaid_credits_<N>_USDC`
 * keys. Returns `null` when the input doesn't match any known shape.
 */
export function canonicalizeCreditsTier(tier: string): string | null {
  const fullMatch = tier.match(TIER_FULL_KEY_RE);
  const candidate = fullMatch ? fullMatch[1] : tier;
  if (!TIER_SUFFIX_RE.test(candidate)) return null;
  return candidate.replace(/usdc$/i, "USDC");
}

export function validateCreditsTier(tier: string): string | null {
  if (canonicalizeCreditsTier(tier) === null) {
    return (
      `Unknown credits tier: ${tier}. ` +
      `Advertised: ${[...ADVERTISED_CREDITS_TIERS].join(", ")}. ` +
      `Or pass a raw backend key like \`prepaid_credits_<N>_USDC\`.`
    );
  }
  return null;
}

export function validateQty(qty: number): string | null {
  if (!Number.isInteger(qty) || qty < 1 || qty > 100) {
    return `Invalid qty: ${qty}. Must be an integer between 1 and 100.`;
  }
  return null;
}

export function validateEmail(email: string): string | null {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return `Invalid email format: ${email}`;
  }
  return null;
}

export function validateAddress(addr: string): string | null {
  if (!BASE58_RE.test(addr)) {
    return `Invalid Solana address: ${addr}`;
  }
  return null;
}

export function validateAddresses(addrs: string[]): string | null {
  for (const addr of addrs) {
    const err = validateAddress(addr);
    if (err) return err;
  }
  return null;
}

export function validateAddressOrDomain(input: string): string | null {
  if (BASE58_RE.test(input)) return null;
  if (input.length <= DOMAIN_MAX_LEN && DOMAIN_RE.test(input)) return null;
  return `Invalid Solana address or domain: ${input}`;
}

export function validateAddressesOrDomains(inputs: string[]): string | null {
  for (const s of inputs) {
    const err = validateAddressOrDomain(s);
    if (err) return err;
  }
  return null;
}

// Transaction signatures are 64 bytes base58-encoded, producing 86-88 characters
const SIGNATURE_RE = /^[1-9A-HJ-NP-Za-km-z]{86,88}$/;

export function validateSignature(sig: string): string | null {
  if (!SIGNATURE_RE.test(sig)) {
    return `Invalid transaction signature: ${sig}`;
  }
  return null;
}

export function validateSlot(slot: string): string | null {
  if (!/^\d+$/.test(slot)) {
    return `Invalid slot number: ${slot}. Must be a positive integer.`;
  }
  return null;
}

export function validateSolanaAddresses(raw: string): string | null {
  const addresses = raw.split(",").map(s => s.trim()).filter(Boolean);
  if (addresses.length === 0) {
    return "No addresses provided. Provide a comma-separated list of Solana addresses.";
  }
  for (const addr of addresses) {
    if (!BASE58_RE.test(addr)) {
      return `Invalid Solana address: ${addr}`;
    }
  }
  return null;
}
