import fs from "fs";
import path from "path";
import os from "os";

const CONFIG_DIR = path.join(os.homedir(), ".helius");
const CONFIG_FILE = path.join(CONFIG_DIR, "config.json");

// Alias for backwards compatibility (used by signup.ts)
export const SHARED_CONFIG_PATH = CONFIG_FILE;

interface Config {
  jwt?: string;
  apiKey?: string;
  network?: "mainnet" | "devnet";
  projectId?: string;
  owsWallet?: string;
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

// Delegates to main config (shared and main are now the same)
export function getSharedApiKey(): string | undefined {
  return getApiKey();
}

export function setSharedApiKey(apiKey: string): void {
  setApiKey(apiKey);
}
