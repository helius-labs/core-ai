import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  getTransfersByAddress: vi.fn(),
}));

vi.mock("../lib/helius.js", () => ({
  resolveNetwork: () => "mainnet",
  setupClient: vi.fn(async () => ({ getTransfersByAddress: h.getTransfersByAddress })),
}));

vi.mock("ora", () => {
  const make = () => {
    const s: any = { start: () => s, stop: () => s, succeed: () => s, fail: () => s };
    return s;
  };
  return { default: make };
});

import { txTransfersCommand } from "./tx.js";

const WALLET = "86xCnPeV69n6t3DnyGvkKobf9FdN2H9oiVDdaMpo2MMY";
const COUNTERPARTY = "3zNWpeRBZY7c5eS5fYboheQP5juPqD525qixxbjiVhEQ";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const NATIVE_SOL = "So11111111111111111111111111111111111111111";

const row = (overrides: Record<string, unknown> = {}) => ({
  signature: "5UfDuX7hXbDjdMRbQMCbNvPZQEr4mEAMq3fNM7oKnUFqpEygPoAEsm2MFVwfCaG1CjprB2og8LmNVBLMrACG7L4",
  slot: 380_000_000,
  blockTime: 1_762_200_000,
  type: "transfer",
  fromUserAccount: COUNTERPARTY,
  toUserAccount: WALLET,
  fromTokenAccount: "FromTokenAccount1111111111111111111111111111",
  toTokenAccount: "ToTokenAccount11111111111111111111111111111",
  mint: USDC,
  amount: "1500000",
  decimals: 6,
  uiAmount: "1.5",
  confirmationStatus: "finalized",
  transactionIdx: 0,
  instructionIdx: 0,
  innerInstructionIdx: 0,
  ...overrides,
});

function capture(fn: () => Promise<void>) {
  const chunks: string[] = [];
  let exitCode: number | null = null;
  const logSpy = vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
    chunks.push(args.map(String).join(" ") + "\n");
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
      let json: any = null;
      for (const c of chunks) {
        try {
          const parsed = JSON.parse(c.trim());
          if (parsed && typeof parsed === "object" && "ok" in parsed) { json = parsed; break; }
        } catch { /* not JSON */ }
      }
      return { json, raw: chunks.join(""), exitCode };
    });
}

beforeEach(() => {
  h.getTransfersByAddress.mockReset();
});

describe("tx transfers", () => {
  it("passes the SDK a single [address, config] tuple with the defaults", async () => {
    const response = { data: [row()], paginationToken: null };
    h.getTransfersByAddress.mockResolvedValue(response);

    const { json } = await capture(() => txTransfersCommand(WALLET, { json: true }));

    // The SDK sends its single argument as the JSON-RPC params; a bare address gets "Parse error"
    expect(h.getTransfersByAddress.mock.calls).toEqual([[[WALLET, { direction: "any", limit: 25, sortOrder: "desc" }]]]);
    expect(json).toEqual({ ok: true, v: 1, data: response });
  });

  it("maps every filter flag into the config", async () => {
    h.getTransfersByAddress.mockResolvedValue({ data: [], paginationToken: null });

    await capture(() => txTransfersCommand(WALLET, {
      limit: "5", sortOrder: "asc", direction: "in", mint: USDC, with: COUNTERPARTY, paginationToken: "PREV",
      commitment: "confirmed", solMode: "separate", amountGte: "1000", blockTimeGte: "1735689600", slotLte: "390000000", json: true,
    }));

    expect(h.getTransfersByAddress).toHaveBeenCalledWith([WALLET, {
      direction: "in", limit: 5, sortOrder: "asc", mint: USDC, with: COUNTERPARTY, paginationToken: "PREV",
      commitment: "confirmed", solMode: "separate",
      filters: { amount: { gte: 1000 }, blockTime: { gte: 1735689600 }, slot: { lte: 390000000 } },
    }]);
  });

  it("labels native SOL, which comes back with the native mint and no token accounts", async () => {
    h.getTransfersByAddress.mockResolvedValue({
      data: [
        row(),
        row({ mint: NATIVE_SOL, amount: "50000", decimals: 9, uiAmount: "0.00005", fromTokenAccount: undefined, toTokenAccount: undefined }),
      ],
      paginationToken: "NEXT",
    });

    const { raw } = await capture(() => txTransfersCommand(WALLET, {}));

    expect(raw).toContain("1.5 EPjF");
    expect(raw).toContain("0.00005 SOL\n");
    expect(raw).not.toContain("SOL SOL");
    expect(raw).toContain("Next: --pagination-token NEXT");
  });

  it("rejects an invalid --direction before calling the API", async () => {
    const { json } = await capture(() => txTransfersCommand(WALLET, { direction: "sideways", json: true }));

    expect(json?.error_code).toBe("INVALID_INPUT");
    expect(h.getTransfersByAddress).not.toHaveBeenCalled();
  });
});
