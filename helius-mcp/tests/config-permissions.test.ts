import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

// POSIX-only: mode bits are meaningless on Windows.
const describePosix = process.platform === 'win32' ? describe.skip : describe;

describePosix('config file permissions', () => {
  let saveConfig: typeof import('../src/utils/config.js').saveConfig;
  let loadConfig: typeof import('../src/utils/config.js').loadConfig;
  let saveKeypairToDisk: typeof import('../src/utils/config.js').saveKeypairToDisk;
  let SHARED_CONFIG_PATH: string;
  let KEYPAIR_PATH: string;
  let fakeHome: string;
  let configDir: string;
  let originalHome: string | undefined;
  let originalUmask: number | undefined;

  beforeAll(async () => {
    // config.ts resolves ~/.helius at import time, so HOME must point at a
    // scratch dir before the dynamic import below. os.homedir() reads $HOME on
    // POSIX, which is why this works.
    fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'helius-perms-'));
    configDir = path.join(fakeHome, '.helius');
    originalHome = process.env.HOME;
    process.env.HOME = fakeHome;

    // Simulate the default Debian/Ubuntu umask — the condition under which the
    // reported 0644 config.json appeared. Without this, a developer running with
    // umask 077 would get 0600 for free and the create-path assertions below
    // would pass even against the unfixed code. Not fatal if it fails (umask is
    // unsettable on some Vitest pools); the pre-existing-permissions tests still
    // detect a regression on their own.
    try {
      originalUmask = process.umask(0o022);
    } catch {
      originalUmask = undefined;
    }

    const mod = await import('../src/utils/config.js');
    saveConfig = mod.saveConfig;
    loadConfig = mod.loadConfig;
    saveKeypairToDisk = mod.saveKeypairToDisk;
    SHARED_CONFIG_PATH = mod.SHARED_CONFIG_PATH;
    KEYPAIR_PATH = mod.KEYPAIR_PATH;

    // Guard against ever writing to the developer's real ~/.helius. If the HOME
    // override did not take effect, these tests would overwrite actual
    // credentials — fail loudly before a single write happens.
    if (!SHARED_CONFIG_PATH.startsWith(fakeHome) || !KEYPAIR_PATH.startsWith(fakeHome)) {
      throw new Error(
        `HOME override did not take effect — refusing to run. ` +
          `Expected paths under ${fakeHome}, got ${SHARED_CONFIG_PATH} and ${KEYPAIR_PATH}.`,
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

  it('writes a newly created config.json as 0600', () => {
    saveConfig({ jwt: 'test-jwt', apiKey: 'test-api-key' });
    expect(mode(SHARED_CONFIG_PATH)).toBe(0o600);
  });

  it('creates the config dir as 0700', () => {
    saveConfig({ jwt: 'test-jwt' });
    expect(mode(configDir)).toBe(0o700);
  });

  // Each test seeds its own config rather than relying on an earlier test's
  // file, so the suite is order-independent under sequence.shuffle.
  it('tightens a pre-existing world-readable config.json on save', () => {
    saveConfig({ jwt: 'seed' });
    fs.chmodSync(SHARED_CONFIG_PATH, 0o644);
    saveConfig({ jwt: 'rotated-jwt' });
    expect(mode(SHARED_CONFIG_PATH)).toBe(0o600);
  });

  it('tightens a pre-existing world-readable config dir on save', () => {
    saveConfig({ jwt: 'seed' });
    fs.chmodSync(configDir, 0o755);
    saveConfig({ jwt: 'test-jwt' });
    expect(mode(configDir)).toBe(0o700);
  });

  // The reported population: set up once, then only read. Nothing on the save
  // path ever runs again, so loadConfig has to be what tightens the file.
  it('self-heals a world-readable config.json on load', () => {
    saveConfig({ jwt: 'stale-jwt', apiKey: 'stale-key' });
    fs.chmodSync(SHARED_CONFIG_PATH, 0o644);
    expect(loadConfig()).toEqual({ jwt: 'stale-jwt', apiKey: 'stale-key' });
    expect(mode(SHARED_CONFIG_PATH)).toBe(0o600);
  });

  it('self-heals a group-readable config.json on load', () => {
    saveConfig({ jwt: 'stale-jwt' });
    fs.chmodSync(SHARED_CONFIG_PATH, 0o640);
    loadConfig();
    expect(mode(SHARED_CONFIG_PATH)).toBe(0o600);
  });

  it('leaves an already-restricted config.json untouched on load', () => {
    saveConfig({ jwt: 'fine-jwt' });
    expect(mode(SHARED_CONFIG_PATH)).toBe(0o600);
    expect(loadConfig()).toEqual({ jwt: 'fine-jwt' });
    expect(mode(SHARED_CONFIG_PATH)).toBe(0o600);
  });

  it('does not create a config on load when none exists', () => {
    fs.rmSync(SHARED_CONFIG_PATH, { force: true });
    expect(loadConfig()).toEqual({});
    expect(fs.existsSync(SHARED_CONFIG_PATH)).toBe(false);
  });

  it('writes the keypair as 0600', () => {
    saveKeypairToDisk(new Uint8Array(64).fill(7));
    expect(mode(KEYPAIR_PATH)).toBe(0o600);
  });

  it('does not corrupt config contents while tightening permissions', () => {
    saveConfig({ jwt: 'round-trip-jwt', apiKey: 'round-trip-key' });
    expect(JSON.parse(fs.readFileSync(SHARED_CONFIG_PATH, 'utf-8'))).toEqual({
      jwt: 'round-trip-jwt',
      apiKey: 'round-trip-key',
    });
  });
});
