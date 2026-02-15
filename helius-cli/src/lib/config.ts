import fs from "fs";
import path from "path";
import os from "os";

const CONFIG_DIR = path.join(os.homedir(), ".helius-cli");
const CONFIG_FILE = path.join(CONFIG_DIR, "config.json");

const SHARED_CONFIG_DIR = path.join(os.homedir(), ".helius");
export const SHARED_CONFIG_PATH = path.join(SHARED_CONFIG_DIR, "config.json");

interface Config {
  jwt?: string;
  apiKey?: string;
  network?: "mainnet" | "devnet";
  projectId?: string;
}

function ensureDir(): void {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }
}

export function load(): Config {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const data = fs.readFileSync(CONFIG_FILE, "utf-8");
      return JSON.parse(data);
    }
  } catch {
    // Return empty config on error
  }
  return {};
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

export function clearConfig(): void {
  save({});
}

export function getSharedApiKey(): string | undefined {
  try {
    if (fs.existsSync(SHARED_CONFIG_PATH)) {
      const data = fs.readFileSync(SHARED_CONFIG_PATH, "utf-8");
      return JSON.parse(data).apiKey;
    }
  } catch {
    // Return undefined on error
  }
  return undefined;
}

export function setSharedApiKey(apiKey: string): void {
  if (!fs.existsSync(SHARED_CONFIG_DIR)) {
    fs.mkdirSync(SHARED_CONFIG_DIR, { recursive: true });
  }
  let config: Record<string, unknown> = {};
  try {
    if (fs.existsSync(SHARED_CONFIG_PATH)) {
      config = JSON.parse(fs.readFileSync(SHARED_CONFIG_PATH, "utf-8"));
    }
  } catch {
    // Start fresh on error
  }
  config.apiKey = apiKey;
  fs.writeFileSync(SHARED_CONFIG_PATH, JSON.stringify(config, null, 2));
}
