import { describe, expect, it, vi, beforeAll, afterAll, beforeEach } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getAddressDecoder } from "@solana/kit";

const h = vi.hoisted(() => ({
  mockCreateStake: vi.fn(),
  mockCreateUnstake: vi.fn(),
  mockCreateWithdraw: vi.fn(),
  mockWithdrawable: vi.fn(),
  mockUnstakeIx: vi.fn(),
  mockWithdrawIx: vi.fn(),
  confirmDestructive: vi.fn(),
}));

vi.mock("../lib/helius.js", () => ({
  setupClient: vi.fn().mockResolvedValue({
    stake: {
      createStakeTransaction: (...args: unknown[]) => h.mockCreateStake(...args),
      createUnstakeTransaction: (...args: unknown[]) => h.mockCreateUnstake(...args),
      createWithdrawTransaction: (...args: unknown[]) => h.mockCreateWithdraw(...args),
      getWithdrawableAmount: (...args: unknown[]) => h.mockWithdrawable(...args),
      getUnstakeInstruction: (...args: unknown[]) => h.mockUnstakeIx(...args),
      getWithdrawInstruction: (...args: unknown[]) => h.mockWithdrawIx(...args),
    },
  }),
}));

// Pass-through spy, so a test can tell whether the confirmation prompt was reached
vi.mock("../lib/output.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../lib/output.js")>();
  h.confirmDestructive.mockImplementation(original.confirmDestructive);
  return { ...original, confirmDestructive: h.confirmDestructive };
});

vi.mock("ora", () => {
  const make = () => {
    const s: any = { start: () => s, stop: () => s, succeed: () => s, fail: () => s };
    return s;
  };
  return { default: make };
});

import {
  stakeCreateCommand, stakeUnstakeCommand, stakeWithdrawCommand,
  stakeUnstakeInstructionCommand, stakeWithdrawInstructionCommand,
} from "./stake.js";

const STAKE_ACCOUNT = "4Nd1mBQtrMJVYVfKf2PJy9NZUZdTAsp7D4xWLs4gDB4T";
const OTHER_WALLET = "86xCnPeV69n6t3DnyGvkKobf9FdN2H9oiVDdaMpo2MMY";

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
  h.mockCreateWithdraw.mockReset().mockResolvedValue({ serializedTx: "AA==" });
  h.mockWithdrawable.mockReset().mockResolvedValue(2_282_880);
  // The SDK's lazy stake namespace returns a Promise on a fresh client's first call
  h.mockUnstakeIx.mockReset().mockResolvedValue({ programAddress: "Stake11111111111111111111111111111111111111" });
  h.mockWithdrawIx.mockReset().mockResolvedValue({ programAddress: "Stake11111111111111111111111111111111111111" });
  h.confirmDestructive.mockClear();
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
  return { exitCode, json, raw: out.join("\n") };
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

  it("says the transaction is already signed and how to send it", async () => {
    const { raw } = await run(() => stakeCreateCommand("1.5", { keypair: keypairPath }));
    expect(raw).toContain("Signed with your keypair and ready to send: run `helius send broadcast <serializedTx>`");
    expect(raw).not.toContain("needs to be signed");
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

  it("rejects a missing keypair before asking for confirmation", async () => {
    const { exitCode } = await run(() => stakeUnstakeCommand(STAKE_ACCOUNT, { keypair: join(dir, "missing.json") }));
    expect(exitCode).toBe(11);
    expect(h.confirmDestructive).not.toHaveBeenCalled();
    expect(h.mockCreateUnstake).not.toHaveBeenCalled();
  });
});

describe("stake withdraw", () => {
  it("withdraws the whole balance, rent reserve included, to the keypair's address by default", async () => {
    const { json } = await run(() => stakeWithdrawCommand(STAKE_ACCOUNT, { keypair: keypairPath, json: true, yes: true }));
    expect(json?.ok).toBe(true);
    expect(h.mockWithdrawable).toHaveBeenCalledWith(STAKE_ACCOUNT, true);
    const [signer, stakeAccount, destination, lamports] = h.mockCreateWithdraw.mock.calls[0];
    expect(signer?.address).toBe(ownerAddress);
    expect(typeof signer?.signTransactions).toBe("function");
    expect(stakeAccount).toBe(STAKE_ACCOUNT);
    expect(destination).toBe(ownerAddress);
    expect(lamports).toBe(2_282_880n);
    expect(json?.data).toMatchObject({ serializedTx: "AA==", destination: ownerAddress, lamports: 2_282_880 });
  });

  it("uses --raw-amount and --destination as given, without looking up the balance", async () => {
    await run(() =>
      stakeWithdrawCommand(STAKE_ACCOUNT, { keypair: keypairPath, rawAmount: "1000000", destination: OTHER_WALLET, json: true, yes: true }),
    );
    expect(h.mockWithdrawable).not.toHaveBeenCalled();
    const [, , destination, lamports] = h.mockCreateWithdraw.mock.calls[0];
    expect(destination).toBe(OTHER_WALLET);
    expect(lamports).toBe(1_000_000n);
  });

  it("fails with INVALID_INPUT and builds nothing when the stake is not withdrawable yet", async () => {
    h.mockWithdrawable.mockResolvedValue(0);
    const { json } = await run(() => stakeWithdrawCommand(STAKE_ACCOUNT, { keypair: keypairPath, json: true, yes: true }));
    expect(json?.error_code).toBe("INVALID_INPUT");
    expect(json?.error).toContain("helius stake withdrawable");
    expect(h.mockCreateWithdraw).not.toHaveBeenCalled();
  });

  it("rejects a missing keypair before asking for confirmation", async () => {
    const { exitCode } = await run(() => stakeWithdrawCommand(STAKE_ACCOUNT, { keypair: join(dir, "missing.json") }));
    expect(exitCode).toBe(11);
    expect(h.confirmDestructive).not.toHaveBeenCalled();
    expect(h.mockCreateWithdraw).not.toHaveBeenCalled();
  });
});

describe("stake unstake-instruction and withdraw-instruction", () => {
  it("passes --owner as a signer and prints the resolved instruction", async () => {
    const { json } = await run(() => stakeUnstakeInstructionCommand(STAKE_ACCOUNT, { owner: OTHER_WALLET, json: true }));
    expect(json?.data).toEqual({ programAddress: "Stake11111111111111111111111111111111111111" });
    const [owner, stakeAccount] = h.mockUnstakeIx.mock.calls[0];
    expect(owner?.address).toBe(OTHER_WALLET);
    expect(typeof owner?.signTransactions).toBe("function");
    expect(stakeAccount).toBe(STAKE_ACCOUNT);
  });

  it("withdraws the whole balance to --owner by default", async () => {
    const { json } = await run(() => stakeWithdrawInstructionCommand(STAKE_ACCOUNT, { owner: OTHER_WALLET, json: true }));
    expect(json?.ok).toBe(true);
    expect(h.mockWithdrawable).toHaveBeenCalledWith(STAKE_ACCOUNT, true);
    const [owner, stakeAccount, destination, lamports] = h.mockWithdrawIx.mock.calls[0];
    expect(owner?.address).toBe(OTHER_WALLET);
    expect(stakeAccount).toBe(STAKE_ACCOUNT);
    expect(destination).toBe(OTHER_WALLET);
    expect(lamports).toBe(2_282_880n);
  });

  it("fails with INVALID_INPUT and never calls the SDK without --owner", async () => {
    const { json } = await run(() => stakeUnstakeInstructionCommand(STAKE_ACCOUNT, { json: true }));
    expect(json?.error_code).toBe("INVALID_INPUT");
    expect(h.mockUnstakeIx).not.toHaveBeenCalled();
  });
});
