import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  PUMP: "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P",
  PUMPSWAP: "pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA",
  USDC: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  WALLET: "86xCnPeV69n6t3DnyGvkKobf9FdN2H9oiVDdaMpo2MMY",
  scan: vi.fn(),
  network: "mainnet" as "mainnet" | "devnet",
}));
const { PUMP, PUMPSWAP, USDC, WALLET } = h;

vi.mock("../lib/helius.js", () => ({
  resolveNetwork: () => h.network,
  setupClient: vi.fn(async () => ({ parsedEvents: { scan: h.scan } })),
}));

vi.mock("ora", () => {
  const make = () => {
    const s: any = { start: () => s, stop: () => s, succeed: () => s, fail: () => s };
    return s;
  };
  return { default: make };
});

import { txScanCommand } from "./tx.js";

const SUMMARY = { stoppedOn: "windowEnd", scannedTransactions: 1200, matchedTransactions: 0, creditsCharged: 12 };

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
  h.scan.mockReset();
  h.network = "mainnet";
});

describe("tx scan", () => {
  it("builds the match and window from flags and prints the response as JSON", async () => {
    const response = { data: [], scan: SUMMARY };
    h.scan.mockResolvedValue(response);

    const { json, exitCode } = await capture(() => txScanCommand(WALLET, {
      programs: PUMP, instructions: "buy, sell",
      mints: USDC, mintScope: "transaction",
      maxScanned: "5000", status: "any", tokenAccounts: "balanceChanged",
      blockTimeGte: "1735689600", slotLte: "390000000",
      json: true,
    }));

    expect(exitCode).toBeNull();
    expect(h.scan).toHaveBeenCalledWith({
      address: WALLET,
      match: { programs: [{ programId: PUMP, instructions: ["buy", "sell"] }], mints: [{ mint: USDC, scope: "transaction" }] },
      returnShape: "transactions",
      limit: 25,
      budget: { maxScannedTransactions: 5000 },
      status: "any",
      tokenAccounts: "balanceChanged",
      time: { gte: 1735689600 },
      slot: { lte: 390000000 },
    });
    expect(json).toEqual({ ok: true, v: 1, data: response });
  });

  it("passes --match through for per-program instruction lists, and sends no limit for counts", async () => {
    h.scan.mockResolvedValue({ scan: SUMMARY });
    const match = { programs: [{ programId: PUMP, instructions: ["buy"] }, { programId: PUMPSWAP }] };

    await capture(() => txScanCommand(WALLET, { match: JSON.stringify(match), returnShape: "count", json: true }));

    expect(h.scan).toHaveBeenCalledWith({ address: WALLET, match, returnShape: "count" });
  });

  it.each([
    ["no programs or mints", {}, "Pass --programs, --mints, or both"],
    ["--match with --programs", { match: "{}", programs: PUMP }, "--match replaces"],
    ["--match that is not JSON", { match: "{programs" }, "--match must be a JSON object"],
    ["--match null", { match: "null" }, "--match: The match must be a JSON object"],
    ["--match array", { match: "[]" }, "--match: The match must be a JSON object"],
    ["--match with no entries", { match: "{}" }, "needs at least one entry in programs or mints"],
    ["--match with only empty lists", { match: '{"programs":[],"mints":[]}' }, "needs at least one entry in programs or mints"],
    ["--match with a misspelled field", { match: `{"program":[{"programId":"${PUMP}"}]}` }, "unknown field(s): program"],
    ["--match with programs as an object", { match: `{"programs":{"programId":"${PUMP}"}}` }, "match.programs must be an array"],
    ["--match with a malformed program entry", { match: '{"programs":[{}]}' }, "match.programs[0].programId must be a Solana address"],
    ["--match with an invalid mint address", { match: '{"mints":[{"mint":"USDC"}]}' }, "match.mints[0].mint must be a Solana address"],
    ["--match with a duplicate program", { match: `{"programs":[{"programId":"${PUMP}"},{"programId":"${PUMP}"}]}` }, "appears more than once"],
    ["--match with a bad scope", { match: `{"mints":[{"mint":"${USDC}","scope":"wallet"}]}` }, 'scope must be "address" or "transaction"'],
    ["--match with non-string instructions", { match: `{"programs":[{"programId":"${PUMP}","instructions":[1]}]}` }, "instructions must be an array of non-empty strings"],
    ["--match with 21 mints", { match: JSON.stringify({ mints: Array.from({ length: 21 }, () => ({ mint: USDC })) }) }, "match.mints has 21 entries; the maximum is 20"],
    ["a discriminator longer than 8 bytes", { programs: PUMP, discriminators: "0x000102030405060708" }, "must be 1 to 8 hex-encoded bytes"],
    ["a discriminator that is not hex", { programs: PUMP, discriminators: "buy" }, "must be 1 to 8 hex-encoded bytes"],
    ["instructions for several programs", { programs: `${PUMP},${PUMPSWAP}`, instructions: "buy" }, "apply to a single program"],
    ["an unknown return shape", { programs: PUMP, returnShape: "rows" }, "--return-shape must be"],
    ["--max-scanned over 10,000", { programs: PUMP, maxScanned: "20000" }, "--max-scanned must be an integer from 1 to 10000"],
    ["a malformed program address", { programs: "not-an-address!" }, "Invalid Solana address"],
  ])("rejects %s before calling the API", async (_name, options, message) => {
    const { json, exitCode } = await capture(() => txScanCommand(WALLET, { ...options, json: true }));

    expect(exitCode).not.toBeNull();
    expect(json?.ok).toBe(false);
    expect(json?.error).toContain(message);
    expect(h.scan).not.toHaveBeenCalled();
  });

  it("refuses on devnet, since Parsed Events serves mainnet only", async () => {
    h.network = "devnet";
    const { json } = await capture(() => txScanCommand(WALLET, { mints: USDC, json: true }));

    expect(json?.error).toContain("mainnet only");
    expect(h.scan).not.toHaveBeenCalled();
  });

  it("prints each parsed match with its full signature, and flags ones the parser could not read", async () => {
    h.scan.mockResolvedValue({
      data: [
        {
          signature: "sigOK",
          parserStatus: "OK",
          parsed: { summary: { type: "swap", description: "W swapped 1 SOL for 2 BONK via Pump.fun" }, blockTime: 1762200000, transactionStatus: "OK" },
        },
        { signature: "sigBad", parserStatus: "ERROR", parserError: { code: "unsupported_version", message: "v1" } },
      ],
      scan: { ...SUMMARY, matchedTransactions: 2 },
    });

    const { raw } = await capture(() => txScanCommand(PUMP, { programs: PUMP }));

    expect(raw).toContain("sigOK");
    expect(raw).toContain("W swapped 1 SOL for 2 BONK via Pump.fun");
    expect(raw).toContain("sigBad  could not be parsed: unsupported_version");
    expect(raw).not.toContain("--pagination-token");
  });

  it("tells the user to keep scanning when a page has no matches but history remains", async () => {
    h.scan.mockResolvedValue({ data: [], paginationToken: "465030307:435", scan: { ...SUMMARY, stoppedOn: "budget" } });

    const { raw } = await capture(() => txScanCommand(PUMP, { programs: PUMP, instructions: "withdraw" }));

    expect(raw).toContain("No matches in the range scanned.");
    expect(raw).toContain("Stopped on budget");
    expect(raw).toContain("Next: --pagination-token 465030307:435");
  });
});
