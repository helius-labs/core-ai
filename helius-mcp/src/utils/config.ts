import fs from "fs";
import path from "path";
import os from "os";

const SHARED_CONFIG_DIR = path.join(os.homedir(), ".helius");
export const SHARED_CONFIG_PATH = path.join(SHARED_CONFIG_DIR, "config.json");

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
