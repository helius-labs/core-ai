import { PLAN_CATALOG } from "../lib/checkout.js";

// Valid plans for signup (includes "basic" which isn't in PLAN_CATALOG)
const SIGNUP_PLANS = new Set(["basic", ...Object.keys(PLAN_CATALOG)]);
const UPGRADE_PLANS = new Set(Object.keys(PLAN_CATALOG));
const VALID_PERIODS = new Set(["monthly", "yearly"]);

// Base58 character set (no 0, O, I, l)
const BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

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

export function validateEmail(email: string): string | null {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return `Invalid email format: ${email}`;
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
