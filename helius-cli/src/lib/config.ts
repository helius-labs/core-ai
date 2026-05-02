import fs from "fs";
import path from "path";
import os from "os";

const CONFIG_DIR = path.join(os.homedir(), ".helius");
const CONFIG_FILE = path.join(CONFIG_DIR, "config.json");

// Alias for backwards compatibility (used by signup.ts)
export const SHARED_CONFIG_PATH = CONFIG_FILE;

/**
 * Shared shape for any in-flight checkout pending local resume. Each
 * caller (signup / upgrade / credits) extends with flow-specific identity
 * fields (wallet address, project id, qty, etc.).
 *
 * Carries the full PaymentLink so `--pay` can pay it, plus the JWT used to
 * create it (kept here, not at the top level, so a later `helius login`
 * rotating top-level JWT can't corrupt --resume).
 *
 * Cleanup rules — DO NOT auto-clear on local `expiresAt`:
 *   - Backend reports `expired` / `failed` → cleared
 *   - Provisioning succeeds (SUCCESS) → cleared
 *   - User passes `--restart` → cleared
 */
export interface PendingPaymentBase {
  paymentIntentId: string;
  paymentUrl: string;
  planName: string;
  amountCents: number;
  destinationWallet: string;
  solanaPayUrl: string;
  /** Always equal to `paymentIntentId`. */
  memo: string;
  expiresAt: string;
  jwt: string;
  /** Set by `--pay` after USDC has been sent but before activation polling lands. */
  txSignature?: string;
  /** ISO timestamp of when the pending intent was first stored. */
  createdAt: string;
}

export interface PendingSignup extends PendingPaymentBase {
  walletAddress: string;
  refId: string;
}

export interface PendingUpgrade extends PendingPaymentBase {
  projectId: string;
  targetPlan: string;
  period?: "monthly" | "yearly";
}

export interface PendingCredits extends PendingPaymentBase {
  projectId: string;
  qty: number;
}

interface Config {
  jwt?: string;
  apiKey?: string;
  network?: "mainnet" | "devnet";
  projectId?: string;
  owsWallet?: string;
  pendingSignup?: PendingSignup;
  pendingUpgrade?: PendingUpgrade;
  pendingCredits?: PendingCredits;
}

function ensureDir(): void {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }
}

/** Try to extract known config fields from corrupted JSON via regex. */
function recoverConfig(raw: string): Config {
  const recovered: Config = {};

  const patterns: { key: keyof Config; regex: RegExp }[] = [
    { key: "jwt", regex: /"jwt"\s*:\s*"([^"]+)"/ },
    { key: "apiKey", regex: /"apiKey"\s*:\s*"([^"]+)"/ },
    { key: "network", regex: /"network"\s*:\s*"(mainnet|devnet)"/ },
    { key: "projectId", regex: /"projectId"\s*:\s*"([^"]+)"/ },
    { key: "owsWallet", regex: /"owsWallet"\s*:\s*"([^"]+)"/ },
  ];

  for (const { key, regex } of patterns) {
    const match = raw.match(regex);
    if (match) {
      (recovered as any)[key] = match[1];
    }
  }

  return recovered;
}

export function load(): Config {
  if (!fs.existsSync(CONFIG_FILE)) {
    return {};
  }

  let raw: string;
  try {
    raw = fs.readFileSync(CONFIG_FILE, "utf-8");
  } catch {
    console.error(`Warning: ${CONFIG_FILE} exists but could not be read.`);
    return {};
  }

  try {
    return JSON.parse(raw);
  } catch {
    const recovered = recoverConfig(raw);
    const recoveredKeys = Object.keys(recovered);

    if (recoveredKeys.length > 0) {
      console.error(`Warning: ${CONFIG_FILE} is corrupted. Recovered: ${recoveredKeys.join(", ")}.`);
      save(recovered);
      console.error(`Repaired config saved. Other fields may have been lost.`);
      return recovered;
    }

    console.error(`Warning: ${CONFIG_FILE} is corrupted and could not be read.`);
    console.error(`Run "helius config clear" to reset, or fix the file manually.`);
    return {};
  }
}

export function save(data: Config): void {
  ensureDir();
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(data, null, 2));
}

export function getJwt(): string | undefined {
  return load().jwt;
}

export function setJwt(jwt: string): void {
  const config = load();
  config.jwt = jwt;
  save(config);
}

export function getApiKey(): string | undefined {
  return load().apiKey;
}

export function setApiKey(apiKey: string): void {
  const config = load();
  config.apiKey = apiKey;
  save(config);
}

export function getNetwork(): "mainnet" | "devnet" {
  return load().network || "mainnet";
}

export function setNetwork(network: "mainnet" | "devnet"): void {
  const config = load();
  config.network = network;
  save(config);
}

export function getProjectId(): string | undefined {
  return load().projectId;
}

export function setProjectId(projectId: string): void {
  const config = load();
  config.projectId = projectId;
  save(config);
}

export function getOwsWallet(): string | undefined {
  return load().owsWallet;
}

export function setOwsWallet(name: string): void {
  const config = load();
  config.owsWallet = name;
  save(config);
}

export function clearOwsWallet(): void {
  const config = load();
  delete config.owsWallet;
  save(config);
}

export function clearConfig(): void {
  save({});
}

export function getPendingSignup(): PendingSignup | undefined {
  return load().pendingSignup;
}

export function setPendingSignup(pending: PendingSignup): void {
  const config = load();
  config.pendingSignup = pending;
  save(config);
}

export function updatePendingSignup(patch: Partial<PendingSignup>): void {
  const config = load();
  if (!config.pendingSignup) return;
  config.pendingSignup = { ...config.pendingSignup, ...patch };
  save(config);
}

export function clearPendingSignup(): void {
  const config = load();
  delete config.pendingSignup;
  save(config);
}

export function getPendingUpgrade(): PendingUpgrade | undefined {
  return load().pendingUpgrade;
}

export function setPendingUpgrade(pending: PendingUpgrade): void {
  const config = load();
  config.pendingUpgrade = pending;
  save(config);
}

export function updatePendingUpgrade(patch: Partial<PendingUpgrade>): void {
  const config = load();
  if (!config.pendingUpgrade) return;
  config.pendingUpgrade = { ...config.pendingUpgrade, ...patch };
  save(config);
}

export function clearPendingUpgrade(): void {
  const config = load();
  delete config.pendingUpgrade;
  save(config);
}

export function getPendingCredits(): PendingCredits | undefined {
  return load().pendingCredits;
}

export function setPendingCredits(pending: PendingCredits): void {
  const config = load();
  config.pendingCredits = pending;
  save(config);
}

export function updatePendingCredits(patch: Partial<PendingCredits>): void {
  const config = load();
  if (!config.pendingCredits) return;
  config.pendingCredits = { ...config.pendingCredits, ...patch };
  save(config);
}

export function clearPendingCredits(): void {
  const config = load();
  delete config.pendingCredits;
  save(config);
}

// Delegates to main config (shared and main are now the same)
export function getSharedApiKey(): string | undefined {
  return getApiKey();
}

export function setSharedApiKey(apiKey: string): void {
  setApiKey(apiKey);
}
