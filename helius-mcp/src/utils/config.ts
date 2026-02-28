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
    budget?: 'free' | 'developer' | 'business' | 'professional';
    complexity?: 'low' | 'medium' | 'high';
  };
}

function ensureDir(): void {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }
}

export function loadConfig(): HeliusConfig {
  try {
    if (fs.existsSync(SHARED_CONFIG_PATH)) {
      const data = fs.readFileSync(SHARED_CONFIG_PATH, "utf-8");
      return JSON.parse(data);
    }
  } catch {
    // Return empty config on error
  }
  return {};
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
