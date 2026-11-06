import { describe, expect, it, vi, beforeAll, afterAll, beforeEach } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getAddressDecoder } from "@solana/kit";

const h = vi.hoisted(() => ({
  mockCreateStake: vi.fn(),
  mockCreateUnstake: vi.fn(),
}));

vi.mock("../lib/helius.js", () => ({
  setupClient: vi.fn().mockResolvedValue({
    stake: {
      createStakeTransaction: (...args: unknown[]) => h.mockCreateStake(...args),
      createUnstakeTransaction: (...args: unknown[]) => h.mockCreateUnstake(...args),
    },
  }),
}));

vi.mock("ora", () => {
  const make = () => {
    const s: any = { start: () => s, stop: () => s, succeed: () => s, fail: () => s };
    return s;
  };
  return { default: make };
});

import { stakeCreateCommand, stakeUnstakeCommand } from "./stake.js";

const STAKE_ACCOUNT = "4Nd1mBQtrMJVYVfKf2PJy9NZUZdTAsp7D4xWLs4gDB4T";

let dir: string;
let keypairPath: string;
let ownerAddress: string;

// Write a real ed25519 keypair in the Solana CLI format (64-byte JSON array: secret || public)
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "helius-stake-test-"));
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const secret = privateKey.export({ format: "der", type: "pkcs8" }).subarray(-32);
  const pub = publicKey.export({ format: "der", type: "spki" }).subarray(-32);
  keypairPath = join(dir, "id.json");
  writeFileSync(keypairPath, JSON.stringify([...secret, ...pub]));
  ownerAddress = getAddressDecoder().decode(pub);
});

afterAll(() => rmSync(dir, { recursive: true, force: true }));

beforeEach(() => {
  h.mockCreateStake.mockReset().mockResolvedValue({ serializedTx: "AA==", stakeAccountPubkey: STAKE_ACCOUNT });
  h.mockCreateUnstake.mockReset().mockResolvedValue({ serializedTx: "AA==" });
});

async function run(fn: () => Promise<void>) {
  const out: string[] = [];
  let exitCode: number | null = null;
  const logSpy = vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => { out.push(a.map(String).join(" ")); });
  const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  const exitSpy = vi.spyOn(process, "exit").mockImplementation(((code: any) => {
    if (exitCode === null) exitCode = typeof code === "number" ? code : 0;
    throw new Error("__test_exit__");
  }) as never);
  try {
    await fn();
  } catch (e) {
    if (!(e instanceof Error && e.message === "__test_exit__")) throw e;
  } finally {
    logSpy.mockRestore();
    errSpy.mockRestore();
    exitSpy.mockRestore();
  }
  const json = out.map((l) => { try { return JSON.parse(l); } catch { return null; } }).find(Boolean);
  return { exitCode, json };
}

describe("stake create", () => {
  it("passes the --keypair signer and the amount in SOL to the SDK", async () => {
    const { json } = await run(() => stakeCreateCommand("1.5", { keypair: keypairPath, json: true }));
    expect(json?.ok).toBe(true);
    expect(h.mockCreateStake).toHaveBeenCalledTimes(1);
    const [signer, amountSol] = h.mockCreateStake.mock.calls[0];
    expect(signer?.address).toBe(ownerAddress);
    expect(typeof signer?.signTransactions).toBe("function");
    expect(amountSol).toBe(1.5);
  });

  it("keeps --raw-amount exact through the SDK's SOL conversion", async () => {
    await run(() => stakeCreateCommand(undefined, { keypair: keypairPath, rawAmount: "1500000001", json: true }));
    const [, amountSol] = h.mockCreateStake.mock.calls[0];
    // The SDK computes lamports as Math.round(amountSol * 1e9)
    expect(Math.round(amountSol * 1e9)).toBe(1500000001);
  });

  it("fails with KEYPAIR_NOT_FOUND and never calls the SDK when the keypair file is missing", async () => {
    const { exitCode, json } = await run(() =>
      stakeCreateCommand("1.5", { keypair: join(dir, "missing.json"), json: true }),
    );
    expect(exitCode).toBe(11);
    expect(json?.error_code).toBe("KEYPAIR_NOT_FOUND");
    expect(h.mockCreateStake).not.toHaveBeenCalled();
  });
});

describe("stake unstake", () => {
  it("passes the --keypair signer and the stake account to the SDK", async () => {
    const { json } = await run(() => stakeUnstakeCommand(STAKE_ACCOUNT, { keypair: keypairPath, json: true }));
    expect(json?.ok).toBe(true);
    expect(h.mockCreateUnstake).toHaveBeenCalledTimes(1);
    const [signer, stakeAccount] = h.mockCreateUnstake.mock.calls[0];
    expect(signer?.address).toBe(ownerAddress);
    expect(stakeAccount).toBe(STAKE_ACCOUNT);
  });

  it("fails with KEYPAIR_NOT_FOUND and never calls the SDK when the keypair file is missing", async () => {
    const { exitCode, json } = await run(() =>
      stakeUnstakeCommand(STAKE_ACCOUNT, { keypair: join(dir, "missing.json"), json: true }),
    );
    expect(exitCode).toBe(11);
    expect(json?.error_code).toBe("KEYPAIR_NOT_FOUND");
    expect(h.mockCreateUnstake).not.toHaveBeenCalled();
  });
});
