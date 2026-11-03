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

const SCAN_SCOPES = new Set(["address", "transaction"]);
const SCAN_MAX_ENTRIES = 20;
const SCAN_MAX_NAMES = 50;
// 1 to 8 hex-encoded bytes, optional 0x prefix
const DISCRIMINATOR_RE = /^(0x)?([0-9a-fA-F]{2}){1,8}$/;

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function unknownFields(entry: Record<string, unknown>, allowed: string[], at: string): string | null {
  const extra = Object.keys(entry).filter((key) => !allowed.includes(key));
  return extra.length > 0 ? `${at} has unknown field(s): ${extra.join(", ")}. Allowed: ${allowed.join(", ")}.` : null;
}

/**
 * Check a Parsed Events scan match against the API's documented rules, so a bad
 * `--match` fails locally instead of spending a request on a 400: an object
 * with `programs`, `mints`, or both; 1-20 entries in each, each address once;
 * up to 50 instruction names and discriminators (1-8 hex bytes) per program;
 * scope "address" or "transaction". Empty lists count as unset, as in the API.
 * Instruction names are checked against IDLs only by the server.
 */
export function validateScanMatch(match: unknown): string | null {
  if (!isPlainObject(match)) return "The match must be a JSON object with programs, mints, or both.";
  const topErr = unknownFields(match, ["programs", "mints"], "The match");
  if (topErr) return topErr;

  const lists: Record<"programs" | "mints", unknown[]> = { programs: [], mints: [] };
  for (const name of ["programs", "mints"] as const) {
    const list = match[name];
    if (list === undefined) continue;
    if (!Array.isArray(list)) return `match.${name} must be an array.`;
    if (list.length > SCAN_MAX_ENTRIES) return `match.${name} has ${list.length} entries; the maximum is ${SCAN_MAX_ENTRIES}.`;
    lists[name] = list;
  }
  if (lists.programs.length === 0 && lists.mints.length === 0) {
    return "The match needs at least one entry in programs or mints.";
  }

  const seenPrograms = new Set<string>();
  for (const [i, entry] of lists.programs.entries()) {
    const at = `match.programs[${i}]`;
    if (!isPlainObject(entry)) return `${at} must be an object with a programId.`;
    const fieldErr = unknownFields(entry, ["programId", "instructions", "discriminators", "scope"], at);
    if (fieldErr) return fieldErr;
    if (typeof entry.programId !== "string" || !BASE58_RE.test(entry.programId)) return `${at}.programId must be a Solana address.`;
    if (seenPrograms.has(entry.programId)) return `${at}.programId ${entry.programId} appears more than once.`;
    seenPrograms.add(entry.programId);
    for (const field of ["instructions", "discriminators"] as const) {
      const values = entry[field];
      if (values === undefined) continue;
      if (!Array.isArray(values) || values.some((v) => typeof v !== "string" || v.trim() === "")) {
        return `${at}.${field} must be an array of non-empty strings.`;
      }
      if (values.length > SCAN_MAX_NAMES) return `${at}.${field} has ${values.length} entries; the maximum is ${SCAN_MAX_NAMES}.`;
    }
    const badDiscriminator = (entry.discriminators as string[] | undefined)?.find((d) => !DISCRIMINATOR_RE.test(d));
    if (badDiscriminator !== undefined) {
      return `${at}.discriminators: "${badDiscriminator}" must be 1 to 8 hex-encoded bytes, with an optional 0x prefix.`;
    }
    if (entry.scope !== undefined && !SCAN_SCOPES.has(entry.scope as string)) return `${at}.scope must be "address" or "transaction".`;
  }

  const seenMints = new Set<string>();
  for (const [i, entry] of lists.mints.entries()) {
    const at = `match.mints[${i}]`;
    if (!isPlainObject(entry)) return `${at} must be an object with a mint.`;
    const fieldErr = unknownFields(entry, ["mint", "scope"], at);
    if (fieldErr) return fieldErr;
    if (typeof entry.mint !== "string" || !BASE58_RE.test(entry.mint)) return `${at}.mint must be a Solana address.`;
    if (seenMints.has(entry.mint)) return `${at}.mint ${entry.mint} appears more than once.`;
    seenMints.add(entry.mint);
    if (entry.scope !== undefined && !SCAN_SCOPES.has(entry.scope as string)) return `${at}.scope must be "address" or "transaction".`;
  }
  return null;
}
