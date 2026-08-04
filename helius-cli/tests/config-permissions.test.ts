import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";

// POSIX-only: mode bits are meaningless on Windows.
const describePosix = process.platform === "win32" ? describe.skip : describe;

describePosix("config file permissions", () => {
  let save: typeof import("../src/lib/config.js").save;
  let load: typeof import("../src/lib/config.js").load;
  let CONFIG_FILE: string;
  let fakeHome: string;
  let configDir: string;
  let originalHome: string | undefined;
  let originalUmask: number | undefined;

  beforeAll(async () => {
    // config.ts resolves ~/.helius at import time, so HOME must point at a
    // scratch dir before the dynamic import below. os.homedir() reads $HOME on
    // POSIX, which is why this works.
    fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), "helius-cli-perms-"));
    configDir = path.join(fakeHome, ".helius");
    originalHome = process.env.HOME;
    process.env.HOME = fakeHome;

    // Simulate the default Debian/Ubuntu umask. Without this, a developer
    // running with umask 077 would get 0600 for free and the create-path
    // assertions would pass even against unfixed code. Not fatal if it fails
    // (umask is unsettable on some Vitest pools); the pre-existing-permissions
    // tests still detect a regression on their own.
    try {
      originalUmask = process.umask(0o022);
    } catch {
      originalUmask = undefined;
    }

    const mod = await import("../src/lib/config.js");
    save = mod.save;
    load = mod.load;
    CONFIG_FILE = mod.SHARED_CONFIG_PATH;

    // Guard against ever writing to the developer's real ~/.helius. If the HOME
    // override did not take effect, these tests would overwrite actual
    // credentials — fail loudly before a single write happens.
    if (!CONFIG_FILE.startsWith(fakeHome)) {
      throw new Error(
        `HOME override did not take effect — refusing to run. ` +
          `Expected a path under ${fakeHome}, got ${CONFIG_FILE}.`,
      );
    }
  });

  afterAll(() => {
    if (originalUmask !== undefined) process.umask(originalUmask);
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
    if (fakeHome) fs.rmSync(fakeHome, { recursive: true, force: true });
  });

  const mode = (p: string) => fs.statSync(p).mode & 0o777;

  it("writes a newly created config.json as 0600", () => {
    save({ jwt: "test-jwt", apiKey: "test-api-key" });
    expect(mode(CONFIG_FILE)).toBe(0o600);
  });

  it("creates the config dir as 0700", () => {
    save({ jwt: "test-jwt" });
    expect(mode(configDir)).toBe(0o700);
  });

  it("tightens a pre-existing world-readable config.json on save", () => {
    save({ jwt: "seed" });
    fs.chmodSync(CONFIG_FILE, 0o644);
    save({ jwt: "rotated-jwt" });
    expect(mode(CONFIG_FILE)).toBe(0o600);
  });

  // The reported population: set up once, then only run read commands. Nothing
  // on the save path ever runs again, so load() has to be what tightens it.
  it("self-heals a world-readable config.json on load", () => {
    save({ jwt: "stale-jwt", apiKey: "stale-key" });
    fs.chmodSync(CONFIG_FILE, 0o644);
    expect(load()).toEqual({ jwt: "stale-jwt", apiKey: "stale-key" });
    expect(mode(CONFIG_FILE)).toBe(0o600);
  });

  it("leaves an already-restricted config.json untouched on load", () => {
    save({ jwt: "fine-jwt" });
    expect(load()).toEqual({ jwt: "fine-jwt" });
    expect(mode(CONFIG_FILE)).toBe(0o600);
  });

  it("does not create a config on load when none exists", () => {
    fs.rmSync(CONFIG_FILE, { force: true });
    expect(load()).toEqual({});
    expect(fs.existsSync(CONFIG_FILE)).toBe(false);
  });
});
