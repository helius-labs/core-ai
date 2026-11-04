import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  AccountRole,
  address,
  appendTransactionMessageInstruction,
  blockhash,
  compileTransaction,
  createTransactionMessage,
  getBase64EncodedWireTransaction,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  SolanaError,
  SOLANA_ERROR__TRANSACTION__FAILED_WHEN_SIMULATING_TO_ESTIMATE_COMPUTE_LIMIT,
} from "@solana/kit";

const h = vi.hoisted(() => ({
  getComputeUnits: vi.fn(),
  setupClient: vi.fn(),
}));

vi.mock("../lib/helius.js", () => ({
  setupClient: h.setupClient,
}));

vi.mock("ora", () => {
  const make = () => {
    const s: any = { start: () => s, stop: () => s, succeed: () => s, fail: () => s };
    return s;
  };
  return { default: make };
});

import { sendComputeUnitsCommand } from "./send.js";

const PAYER = address("86xCnPeV69n6t3DnyGvkKobf9FdN2H9oiVDdaMpo2MMY");
const SYSTEM_PROGRAM = address("11111111111111111111111111111111");
const BLOCKHASH = blockhash("EkSnNWid2cvwEVnVx9aBqawnmiCNiDgp3gUdkDPTKN1N");

// An unsigned v0 SOL transfer, serialized the way wallets and SDKs hand it over
function transferTransaction(): string {
  const data = new Uint8Array(12);
  const view = new DataView(data.buffer);
  view.setUint32(0, 2, true);
  view.setBigUint64(4, 1n, true);
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayer(PAYER, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash({ blockhash: BLOCKHASH, lastValidBlockHeight: 0n }, m),
    (m) => appendTransactionMessageInstruction({
      programAddress: SYSTEM_PROGRAM,
      accounts: [{ address: PAYER, role: AccountRole.WRITABLE_SIGNER }, { address: PAYER, role: AccountRole.WRITABLE_SIGNER }],
      data,
    }, m),
  );
  return getBase64EncodedWireTransaction(compileTransaction(message));
}

function capture(fn: () => Promise<void>) {
  const chunks: string[] = [];
  const errors: string[] = [];
  let exitCode: number | null = null;
  const logSpy = vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
    chunks.push(args.map(String).join(" ") + "\n");
  });
  const errSpy = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    errors.push(args.map(String).join(" ") + "\n");
  });
  const exitSpy = vi.spyOn(process, "exit").mockImplementation(((code: any) => {
    if (exitCode === null) exitCode = typeof code === "number" ? code : 0;
    throw new Error("__test_exit__");
  }) as never);

  return fn()
    .catch((e) => {
      if (e instanceof Error && e.message === "__test_exit__") return;
      throw e;
    })
    .finally(() => {
      logSpy.mockRestore();
      errSpy.mockRestore();
      exitSpy.mockRestore();
    })
    .then(() => {
      let json: any = null;
      for (const c of chunks) {
        try {
          const parsed = JSON.parse(c.trim());
          if (parsed && typeof parsed === "object" && "ok" in parsed) { json = parsed; break; }
        } catch { /* not JSON */ }
      }
      return { json, raw: chunks.join(""), stderr: errors.join(""), exitCode };
    });
}

beforeEach(() => {
  h.getComputeUnits.mockReset();
  h.setupClient.mockReset();
  h.setupClient.mockResolvedValue({ kitRpc: {}, tx: { getComputeUnits: h.getComputeUnits } });
});

describe("send compute-units", () => {
  it("decodes the base64 transaction into a message before estimating", async () => {
    h.getComputeUnits.mockResolvedValue(1_000);

    const { json, exitCode } = await capture(() => sendComputeUnitsCommand(transferTransaction(), { json: true }));

    expect(exitCode).toBeNull();
    expect(json).toEqual({ ok: true, v: 1, data: { computeUnits: 1_000 } });
    const [message] = h.getComputeUnits.mock.calls[0];
    expect(typeof message).toBe("object");
    expect(message.feePayer.address).toBe(PAYER);
    expect(message.lifetimeConstraint.blockhash).toBe(BLOCKHASH);
    expect(message.instructions[0].programAddress).toBe(SYSTEM_PROGRAM);
  });

  it("accepts surrounding whitespace and prints the estimate", async () => {
    h.getComputeUnits.mockResolvedValue(143_453);

    const { raw } = await capture(() => sendComputeUnitsCommand(`  ${transferTransaction()}\n`, {}));

    expect(raw).toContain("143,453 CU");
    expect(raw).toContain("10% margin");
  });

  it("reports a transaction that fails in simulation, with its logs", async () => {
    const logs = ["Program 11111111111111111111111111111111 invoke [1]", "Transfer: insufficient lamports 5000, need 10000"];
    h.getComputeUnits.mockRejectedValue(new SolanaError(SOLANA_ERROR__TRANSACTION__FAILED_WHEN_SIMULATING_TO_ESTIMATE_COMPUTE_LIMIT, {
      cause: new Error("Custom program error: #1 (instruction #1)"),
      unitsConsumed: 150n,
      logs,
    } as any));

    const { json, exitCode } = await capture(() => sendComputeUnitsCommand(transferTransaction(), { json: true }));

    expect(exitCode).toBe(53);
    expect(json?.error_code).toBe("INVALID_INPUT");
    expect(json?.error).toContain("fails in simulation (Custom program error: #1 (instruction #1))");
    expect(json?.details).toEqual({ unitsConsumed: 150, logs });
  });

  it("prints the program logs in the terminal when simulation fails", async () => {
    h.getComputeUnits.mockRejectedValue(new SolanaError(SOLANA_ERROR__TRANSACTION__FAILED_WHEN_SIMULATING_TO_ESTIMATE_COMPUTE_LIMIT, {
      cause: new Error("Custom program error: #1 (instruction #1)"),
      unitsConsumed: 150n,
      logs: ["Transfer: insufficient lamports 5000, need 10000"],
    } as any));

    const { stderr, exitCode } = await capture(() => sendComputeUnitsCommand(transferTransaction(), {}));

    expect(exitCode).toBe(53);
    expect(stderr).toContain("Transfer: insufficient lamports 5000, need 10000");
  });

  it.each([
    ["malformed base64", "not-valid-base64!!!", "Invalid base64 transaction payload"],
    ["a payload shorter than a signature", "AAAA", "shorter than a 64-byte Solana signature"],
    ["bytes that are not a transaction", Buffer.alloc(128, 0xff).toString("base64"), "does not decode to a serialized Solana transaction"],
  ])("rejects %s before calling the API", async (_name, input, message) => {
    const { json, exitCode } = await capture(() => sendComputeUnitsCommand(input, { json: true }));

    expect(exitCode).toBe(53);
    expect(json?.error_code).toBe("INVALID_INPUT");
    expect(json?.error).toContain(message);
    expect(h.setupClient).not.toHaveBeenCalled();
  });
});
