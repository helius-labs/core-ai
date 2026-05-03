import fs from "fs";
import path from "path";
import os from "os";

const CONFIG_DIR = path.join(os.homedir(), ".helius");
export const SHARED_CONFIG_PATH = path.join(CONFIG_DIR, "config.json");
export const KEYPAIR_PATH = path.join(CONFIG_DIR, "keypair.json");

interface HeliusConfig {
  apiKey?: string;
  jwt?: string;
  network?: string;
  projectId?: string;
  preferences?: {
    budget?: 'agent' | 'developer' | 'business' | 'professional';
    complexity?: 'low' | 'medium' | 'high';
  };
}

function ensureDir(): void {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }
}

/** Best-effort recovery when config.json is corrupted (matches helius-cli behavior). */
function recoverPartialConfig(raw: string): HeliusConfig {
  const recovered: HeliusConfig = {};
  const patterns: { key: keyof HeliusConfig; regex: RegExp }[] = [
    { key: "jwt", regex: /"jwt"\s*:\s*"([^"]+)"/ },
    { key: "apiKey", regex: /"apiKey"\s*:\s*"([^"]+)"/ },
    {
      key: "network",
      regex: /"network"\s*:\s*"(mainnet|mainnet-beta|devnet)"/,
    },
    { key: "projectId", regex: /"projectId"\s*:\s*"([^"]+)"/ },
  ];

  for (const { key, regex } of patterns) {
    const match = raw.match(regex);
    if (match) {
      (recovered as Record<string, string>)[key] = match[1];
    }
  }

  const budgetMatch = raw.match(/"budget"\s*:\s*"(free|developer|business|professional)"/);
  const complexityMatch = raw.match(/"complexity"\s*:\s*"(low|medium|high)"/);
  if (budgetMatch || complexityMatch) {
    recovered.preferences = {};
    if (budgetMatch) {
      recovered.preferences.budget = budgetMatch[1] as NonNullable<
        HeliusConfig["preferences"]
      >["budget"];
    }
    if (complexityMatch) {
      recovered.preferences.complexity = complexityMatch[1] as NonNullable<
        HeliusConfig["preferences"]
      >["complexity"];
    }
  }

  return recovered;
}

function recoveredFieldSummary(cfg: HeliusConfig): string {
  const keys: string[] = [];
  for (const k of Object.keys(cfg) as (keyof HeliusConfig)[]) {
    if (k === "preferences" && cfg.preferences) {
      for (const pk of Object.keys(cfg.preferences)) {
        keys.push(`preferences.${pk}`);
      }
    } else if (k !== "preferences") {
      keys.push(k);
    }
  }
  return keys.join(", ");
}

export function loadConfig(): HeliusConfig {
  if (!fs.existsSync(SHARED_CONFIG_PATH)) {
    return {};
  }

  let raw: string;
  try {
    raw = fs.readFileSync(SHARED_CONFIG_PATH, "utf-8");
  } catch {
    console.error(`Warning: ${SHARED_CONFIG_PATH} exists but could not be read.`);
    return {};
  }

  try {
    return JSON.parse(raw) as HeliusConfig;
  } catch {
    const recovered = recoverPartialConfig(raw);
    const summary = recoveredFieldSummary(recovered);

    if (summary.length > 0) {
      console.error(
        `Warning: ${SHARED_CONFIG_PATH} is corrupted (invalid JSON). Recovered fields: ${summary}.`,
      );
      saveConfig(recovered);
      console.error("Repaired config saved. Fields that did not match known keys may have been lost.");
      return recovered;
    }

    console.error(
      `Warning: ${SHARED_CONFIG_PATH} is corrupted (invalid JSON) and could not be recovered.`,
    );
    console.error(
      'Run Helius MCP config helpers or edit the file manually; see CLI `helius config clear` if you use helius-cli.',
    );
    return {};
  }
}

export function saveConfig(config: HeliusConfig): void {
  ensureDir();
  fs.writeFileSync(SHARED_CONFIG_PATH, JSON.stringify(config, null, 2));
}

export function getSharedApiKey(): string | undefined {
  return loadConfig().apiKey;
}

export function setSharedApiKey(apiKey: string): void {
  const config = loadConfig();
  config.apiKey = apiKey;
  saveConfig(config);
}

export function getJwt(): string | undefined {
  return loadConfig().jwt;
}

export function setJwt(jwt: string): void {
  const config = loadConfig();
  config.jwt = jwt;
  saveConfig(config);
}

// Preferences

export function getPreferences() {
  return loadConfig().preferences ?? {};
}

export function savePreferences(prefs: HeliusConfig['preferences']) {
  const config = loadConfig();
  config.preferences = { ...config.preferences, ...prefs };
  saveConfig(config);
}

// Keypair disk I/O

export function keypairExistsOnDisk(): boolean {
  return fs.existsSync(KEYPAIR_PATH);
}

export function loadKeypairFromDisk(): Uint8Array | null {
  try {
    if (fs.existsSync(KEYPAIR_PATH)) {
      const data = fs.readFileSync(KEYPAIR_PATH, "utf-8");
      const arr = JSON.parse(data);
      if (Array.isArray(arr) && arr.length === 64) {
        return new Uint8Array(arr);
      }
    }
  } catch {
    // Return null on error
  }
  return null;
}

export function saveKeypairToDisk(secretKey: Uint8Array): void {
  ensureDir();
  fs.writeFileSync(KEYPAIR_PATH, JSON.stringify(Array.from(secretKey)));
  fs.chmodSync(KEYPAIR_PATH, 0o600);
}
