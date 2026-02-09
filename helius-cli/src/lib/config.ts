import fs from "fs";
import path from "path";
import os from "os";

const CONFIG_DIR = path.join(os.homedir(), ".helius-cli");
const CONFIG_FILE = path.join(CONFIG_DIR, "config.json");

interface Config {
  jwt?: string;
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
