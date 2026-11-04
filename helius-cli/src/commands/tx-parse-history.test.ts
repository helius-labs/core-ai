import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  SIG: "5UfDuX7hXbDjdMRbQMCbNvPZQEr4mEAMq3fNM7oKnUFqpEygPoAEsm2MFVwfCaG1CjprB2og8LmNVBLMrACG7L4",
  WALLET: "86xCnPeV69n6t3DnyGvkKobf9FdN2H9oiVDdaMpo2MMY",
  parseTransactions: vi.fn(),
  getTransactionHistory: vi.fn(),
  getTransactions: vi.fn(),
  getTransactionsByAddress: vi.fn(),
  network: "mainnet" as "mainnet" | "devnet",
}));
const { SIG, WALLET } = h;

vi.mock("../lib/helius.js", () => ({
  resolveNetwork: () => h.network,
  setupClient: vi.fn(async () => ({
    parsedEvents: { parseTransactions: h.parseTransactions, getTransactionHistory: h.getTransactionHistory },
    enhanced: { getTransactions: h.getTransactions, getTransactionsByAddress: h.getTransactionsByAddress },
  })),
}));

vi.mock("ora", () => {
  const make = () => {
    const s: any = { start: () => s, stop: () => s, succeed: () => s, fail: () => s };
    return s;
  };
  return { default: make };
});

import { txHistoryCommand, txParseCommand } from "./tx.js";

const JUP = "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

function parsedTx(overrides: Record<string, unknown> = {}) {
  return {
    slot: 380_000_000,
    blockTime: 1_762_200_000,
    fee: 5_000,
    feePayer: WALLET,
    transactionStatus: "OK",
    summary: { type: "swap", description: `${WALLET} swapped 1 SOL for 1.5 USDC`, parsedData: { protocol: "jupiter" } },
    instructions: [
      { instructionIndex: 0, innerInstructionIndex: null, programId: JUP, programName: "jupiter", instructionName: "route" },
      { instructionIndex: 0, innerInstructionIndex: 0, programId: JUP, programName: "jupiter", instructionName: "inner" },
    ],
    tokenTransfers: [{ fromUserAccount: WALLET, toUserAccount: JUP, mint: USDC, rawTokenAmount: 1_500_000, decimals: 6 }],
    nativeTransfers: [],
    ...overrides,
  };
}
const ok = (signature: string, overrides: Record<string, unknown> = {}) => ({ signature, parserStatus: "OK", parsed: parsedTx(overrides) });
const notFound = (signature: string) => ({
  signature,
  parserStatus: "ERROR",
  parserError: { code: "transaction_not_found", message: "transaction was not found" },
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
  for (const mock of [h.parseTransactions, h.getTransactionHistory, h.getTransactions, h.getTransactionsByAddress]) mock.mockReset();
  h.network = "mainnet";
});

describe("tx parse", () => {
  it("parses with Parsed Events on mainnet and prints the results as JSON", async () => {
    const results = [ok(SIG)];
    h.parseTransactions.mockResolvedValue(results);

    const { json } = await capture(() => txParseCommand([SIG], { json: true }));

    expect(h.parseTransactions).toHaveBeenCalledWith({ transactions: [SIG] });
    expect(h.getTransactions).not.toHaveBeenCalled();
    expect(json).toEqual({ ok: true, v: 1, data: results });
  });

  it("sends at most 100 signatures per request", async () => {
    h.parseTransactions.mockImplementation(async ({ transactions }: { transactions: string[] }) => transactions.map((s) => ok(s)));

    const { json } = await capture(() => txParseCommand(Array(150).fill(SIG), { json: true }));

    expect(h.parseTransactions.mock.calls.map(([req]) => req.transactions.length)).toEqual([100, 50]);
    expect(json.data).toHaveLength(150);
  });

  it("prints decoded instructions, scaled token amounts, and a decoded program error", async () => {
    h.parseTransactions.mockResolvedValue([
      ok(SIG, {
        transactionStatus: "ERROR",
        decodedError: { programName: "jupiter", code: 6001, name: "SlippageToleranceExceeded", msg: "Slippage tolerance exceeded", instructionIndex: 0 },
      }),
    ]);

    const { raw } = await capture(() => txParseCommand([SIG], {}));

    expect(raw).toContain("Swap");
    expect(raw).toContain("Protocol:     Jupiter");
    expect(raw).toContain("[0] jupiter.route");
    expect(raw).not.toContain("jupiter.inner");
    expect(raw).toContain(`1.5 ${USDC}`);
    expect(raw).toContain("Failed — jupiter error 6001 SlippageToleranceExceeded: Slippage tolerance exceeded (instruction 0)");
  });

  it("lists signatures the parser could not find as warnings", async () => {
    const missing = SIG.slice(0, -1) + "8";
    h.parseTransactions.mockResolvedValue([ok(SIG), notFound(missing)]);

    const { raw } = await capture(() => txParseCommand([SIG, missing], {}));

    expect(raw).toContain("Warnings:");
    expect(raw).toContain(`${missing} not found on mainnet`);
  });

  it("keeps the Enhanced Transactions API on devnet, where Parsed Events is unavailable", async () => {
    const legacy = [{ signature: SIG, type: "SWAP", source: "JUPITER", description: "legacy" }];
    h.network = "devnet";
    h.getTransactions.mockResolvedValue(legacy);

    const { json } = await capture(() => txParseCommand([SIG], { json: true }));

    expect(h.getTransactions).toHaveBeenCalledWith({ transactions: [SIG] });
    expect(h.parseTransactions).not.toHaveBeenCalled();
    expect(json.data).toEqual(legacy);
  });

  it("rejects a malformed signature before calling the API", async () => {
    const { json } = await capture(() => txParseCommand(["not-a-signature"], { json: true }));

    expect(json?.error_code).toBe("INVALID_INPUT");
    expect(h.parseTransactions).not.toHaveBeenCalled();
  });
});

describe("tx history", () => {
  it("maps every flag onto a Parsed Events history request, with a default limit of 10", async () => {
    const response = { data: [ok(SIG)], paginationToken: "380000000:5" };
    h.getTransactionHistory.mockResolvedValue(response);

    const { json } = await capture(() => txHistoryCommand(WALLET, {
      before: SIG, sortOrder: "asc", status: "any", tokenAccounts: "balanceChanged", commitment: "finalized",
      blockTimeGte: "1735689600", slotLte: "390000000", paginationToken: "PREV", json: true,
    }));

    expect(h.getTransactionHistory).toHaveBeenCalledWith({
      address: WALLET, limit: 10, beforeSignature: SIG, sortOrder: "asc", commitment: "finalized",
      status: "any", tokenAccounts: "balanceChanged", time: { gte: 1735689600 }, slot: { lte: 390000000 }, paginationToken: "PREV",
    });
    expect(h.getTransactionsByAddress).not.toHaveBeenCalled();
    expect(json).toEqual({ ok: true, v: 1, data: response });
  });

  it("explains that --type was removed and points to tx scan", async () => {
    const { json, exitCode } = await capture(() => txHistoryCommand(WALLET, { type: "SWAP", json: true }));

    expect(exitCode).not.toBeNull();
    expect(json?.error_code).toBe("INVALID_INPUT");
    expect(json?.error).toContain("--type was removed");
    expect(json?.error).toContain("helius tx scan");
    expect(h.getTransactionHistory).not.toHaveBeenCalled();
  });

  it.each([
    ["--limit above 100", { limit: "101" }, "--limit must be an integer from 1 to 100"],
    ["an unknown --status", { status: "ok" }, "--status must be"],
    ["an unknown --commitment", { commitment: "processed" }, "--commitment must be"],
    ["a malformed --before", { before: "nope" }, "Invalid"],
  ])("rejects %s before calling the API", async (_name, options, message) => {
    const { json } = await capture(() => txHistoryCommand(WALLET, { ...options, json: true }));

    expect(json?.error).toContain(message);
    expect(h.getTransactionHistory).not.toHaveBeenCalled();
  });

  it("prints full signatures, parser errors, the success-only note, and the next page token", async () => {
    const missing = SIG.slice(0, -1) + "8";
    h.getTransactionHistory.mockResolvedValue({ data: [ok(SIG), notFound(missing)], paginationToken: "380000000:5" });

    const { raw } = await capture(() => txHistoryCommand(WALLET, {}));

    expect(raw).toContain(SIG);
    expect(raw).toContain(`${WALLET} swapped 1 SOL for 1.5 USDC`);
    expect(raw).toContain(`${missing} not found on mainnet`);
    expect(raw).toContain("Successful transactions only; pass --status any");
    expect(raw).toContain("Next: --pagination-token 380000000:5");
  });

  it("maps the flags Enhanced Transactions supports on devnet", async () => {
    h.network = "devnet";
    h.getTransactionsByAddress.mockResolvedValue([]);

    await capture(() => txHistoryCommand(WALLET, {
      limit: "5", before: SIG, sortOrder: "desc", commitment: "confirmed", blockTimeGte: "1", blockTimeLte: "2", slotGte: "3", slotLte: "4", json: true,
    }));

    expect(h.getTransactionsByAddress).toHaveBeenCalledWith({
      address: WALLET, limit: 5, beforeSignature: SIG, sortOrder: "desc", commitment: "confirmed",
      gteTime: 1, lteTime: 2, gteSlot: 3, lteSlot: 4,
    });
    expect(h.getTransactionHistory).not.toHaveBeenCalled();
  });

  it("refuses mainnet-only flags on devnet instead of ignoring them", async () => {
    h.network = "devnet";

    const { json } = await capture(() => txHistoryCommand(WALLET, { status: "any", paginationToken: "T", json: true }));

    expect(json?.error).toContain("--status, --pagination-token are only available on mainnet");
    expect(h.getTransactionsByAddress).not.toHaveBeenCalled();
  });
});
