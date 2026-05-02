import { PLAN_CATALOG } from "../lib/checkout.js";

// Valid plans for signup. "basic" was the legacy $1 entry plan; Phase 1 of the
// crypto-checkout revamp replaces it with "agent" ($10 one-time, 1M credits).
// `--plan basic` is explicitly rejected with a hint to use `--plan agent`.
//
// `agent` lives outside PLAN_CATALOG (which only models monthly/yearly
// subscription tiers); we list it here explicitly.
const SIGNUP_PLANS = new Set(["agent", ...Object.keys(PLAN_CATALOG)]);
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
  const normalized = plan.toLowerCase();
  if (normalized === "basic") {
    return "The 'basic' plan was retired. Use --plan agent ($10 USDC one-time, 1,000,000 starting credits).";
  }
  if (!SIGNUP_PLANS.has(normalized)) {
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
