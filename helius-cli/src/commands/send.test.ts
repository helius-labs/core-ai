import { describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  VALID_TX_B64: Buffer.alloc(128, 1).toString("base64"),
  VALID_SIG: "5".repeat(88),
  mockBroadcast: vi.fn(),
  mockSendTx: vi.fn(),
  mockPoll: vi.fn(),
  mockGetCu: vi.fn(),
}));

vi.mock("../lib/helius.js", () => ({
  setupClient: vi.fn().mockResolvedValue({
    tx: {
      broadcastTransaction: (...args: unknown[]) => h.mockBroadcast(...args),
      sendTransaction: (...args: unknown[]) => h.mockSendTx(...args),
      pollTransactionConfirmation: (...args: unknown[]) => h.mockPoll(...args),
      getComputeUnits: (...args: unknown[]) => h.mockGetCu(...args),
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

import {
  sendBroadcastCommand,
  sendRawCommand,
  sendSenderCommand,
  sendPollCommand,
  sendComputeUnitsCommand,
} from "./send.js";

interface CapturedJson {
  ok: boolean;
  error_code?: string;
  data?: any;
}

function captureStdout(fn: () => Promise<void>) {
  const chunks: string[] = [];
  let exitCode: number | null = null;
  const logSpy = vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
    chunks.push(args.map((a) => (typeof a === "string" ? a : String(a))).join(" ") + "\n");
  });
  const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
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
      let json: CapturedJson | null = null;
      for (const c of chunks) {
        try {
          const parsed = JSON.parse(c.trim());
          if (parsed && typeof parsed === "object" && "ok" in parsed) {
            json = parsed;
            break;
          }
        } catch {
          /* not JSON */
        }
      }
      return { json, raw: chunks.join(""), exitCode };
    });
}

describe("send commands input pre-validation and execution", () => {
  it("rejects malformed base64 in sendBroadcastCommand before dry-run or RPC call", async () => {
    h.mockBroadcast.mockReset();
    const { json, exitCode } = await captureStdout(() =>
      sendBroadcastCommand("not-valid-base64!!!", { dryRun: true, json: true }),
    );

    expect(exitCode).toBe(53);
    expect(json?.ok).toBe(false);
    expect(json?.error_code).toBe("INVALID_INPUT");
    expect(h.mockBroadcast).not.toHaveBeenCalled();
  });

  it("rejects decoded payloads shorter than 64 bytes in sendRawCommand", async () => {
    h.mockSendTx.mockReset();
    const shortB64 = Buffer.alloc(16, 1).toString("base64");
    const { json, exitCode } = await captureStdout(() =>
      sendRawCommand(shortB64, { yes: true, json: true }),
    );

    expect(exitCode).toBe(53);
    expect(json?.error_code).toBe("INVALID_INPUT");
    expect(h.mockSendTx).not.toHaveBeenCalled();
  });

  it("supports dry-run for valid base64 in sendSenderCommand without submitting", async () => {
    h.mockSendTx.mockReset();
    const { json, exitCode } = await captureStdout(() =>
      sendSenderCommand(h.VALID_TX_B64, { dryRun: true, region: "US_EAST", json: true }),
    );

    expect(exitCode).toBeNull();
    expect(json?.ok).toBe(true);
    expect(json?.data).toEqual({
      dryRun: true,
      transaction: h.VALID_TX_B64,
      region: "US_EAST",
    });
    expect(h.mockSendTx).not.toHaveBeenCalled();
  });

  it("rejects invalid signatures in sendPollCommand", async () => {
    h.mockPoll.mockReset();
    const { json, exitCode } = await captureStdout(() =>
      sendPollCommand("bad-sig", { json: true }),
    );

    expect(exitCode).toBe(53);
    expect(json?.error_code).toBe("INVALID_INPUT");
    expect(h.mockPoll).not.toHaveBeenCalled();
  });

  it("rejects invalid base64 in sendComputeUnitsCommand and simulates valid payloads", async () => {
    h.mockGetCu.mockReset().mockResolvedValue(42000);
    const invalidRes = await captureStdout(() =>
      sendComputeUnitsCommand("invalid_b64", { json: true }),
    );
    expect(invalidRes.exitCode).toBe(53);
    expect(h.mockGetCu).not.toHaveBeenCalled();

    const validRes = await captureStdout(() =>
      sendComputeUnitsCommand(h.VALID_TX_B64, { json: true }),
    );
    expect(validRes.exitCode).toBeNull();
    expect(validRes.json?.ok).toBe(true);
    expect(validRes.json?.data.computeUnits).toBe(42000);
  });
});
