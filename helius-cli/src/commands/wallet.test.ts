import { describe, expect, it, vi } from "vitest";

// Hoisted so the vi.mock factory (which runs before module init) can reference
// the mock fns. WALLET/MINT are valid base58 pubkeys so the real
// validateAddress() passes.
const h = vi.hoisted(() => ({
  WALLET: "86xCnPeV69n6t3DnyGvkKobf9FdN2H9oiVDdaMpo2MMY",
  USDC: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  SOL: "So11111111111111111111111111111111111111111",
  mockRestRequest: vi.fn(),
}));
const { WALLET, USDC, SOL } = h;

vi.mock("../lib/helius.js", () => ({
  resolveApiKey: vi.fn().mockResolvedValue("test-key"),
  restRequest: (...args: unknown[]) => h.mockRestRequest(...args),
}));

vi.mock("ora", () => {
  const make = () => {
    const s: any = { start: () => s, stop: () => s, succeed: () => s, fail: () => s };
    return s;
  };
  return { default: make };
});

import { walletBalanceAtCommand } from "./wallet.js";

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
          if (parsed && typeof parsed === "object" && "ok" in parsed) { json = parsed; break; }
        } catch { /* not JSON */ }
      }
      return { json, raw: chunks.join(""), exitCode };
    });
}

describe("wallet balance-at command", () => {
  it("queries balance-at with the slot selector and returns the balance as JSON", async () => {
    h.mockRestRequest.mockReset().mockResolvedValue({
      wallet: WALLET, mint: USDC, isNative: false,
      balance: "284961463.392936", balanceRaw: "284961463392936", decimals: 6,
      requested: { time: null, slot: 313000000, datetime: null },
      asOf: { slot: 313000000, blockTime: 1736536794, signature: "5Cyy7Mh" },
    });

    const { json, exitCode } = await captureStdout(() =>
      walletBalanceAtCommand(WALLET, { mint: USDC, slot: "313000000", json: true }));

    expect(exitCode).toBeNull();
    expect(json?.ok).toBe(true);
    expect(json?.data.balance).toBe("284961463.392936");
    expect(h.mockRestRequest).toHaveBeenCalledWith(
      `/v1/wallet/${WALLET}/balance-at?mint=${USDC}&slot=313000000`,
      "test-key",
    );
  });

  it("rejects when no time/datetime/slot selector is provided", async () => {
    h.mockRestRequest.mockReset();
    const { json, exitCode } = await captureStdout(() =>
      walletBalanceAtCommand(WALLET, { mint: SOL, json: true }));

    expect(exitCode).toBe(53); // INVALID_INPUT
    expect(json?.ok).toBe(false);
    expect(json?.error_code).toBe("INVALID_INPUT");
    expect(h.mockRestRequest).not.toHaveBeenCalled();
  });

  it("rejects when more than one selector is provided", async () => {
    h.mockRestRequest.mockReset();
    const { exitCode } = await captureStdout(() =>
      walletBalanceAtCommand(WALLET, { mint: SOL, time: "1", slot: "2", json: true }));

    expect(exitCode).toBe(53);
    expect(h.mockRestRequest).not.toHaveBeenCalled();
  });

  it("rejects a non-numeric --slot before calling the API", async () => {
    h.mockRestRequest.mockReset();
    const { json, exitCode } = await captureStdout(() =>
      walletBalanceAtCommand(WALLET, { mint: USDC, slot: "not-a-slot", json: true }));

    expect(exitCode).toBe(53);
    expect(json?.error_code).toBe("INVALID_INPUT");
    expect(h.mockRestRequest).not.toHaveBeenCalled();
  });

  it("echoes the resolved epoch for a datetime query (terminal output)", async () => {
    h.mockRestRequest.mockReset().mockResolvedValue({
      wallet: WALLET, mint: SOL, isNative: true,
      balance: "1.5", balanceRaw: "1500000000", decimals: 9,
      requested: { time: 1736536800, slot: null, datetime: "2025-01-10 19:20:00" },
      asOf: { slot: 313000000, blockTime: 1736536794, signature: "5Cyy7Mh" },
    });

    const { raw, exitCode } = await captureStdout(() =>
      walletBalanceAtCommand(WALLET, { mint: SOL, datetime: "2025-01-10 19:20:00" }));

    expect(exitCode).toBeNull();
    expect(raw).toContain("Resolved:");
    expect(raw).toContain("1736536800");
    expect(h.mockRestRequest).toHaveBeenCalledWith(
      `/v1/wallet/${WALLET}/balance-at?mint=${SOL}&datetime=2025-01-10+19%3A20%3A00`,
      "test-key",
    );
  });

  it("requires --mint", async () => {
    h.mockRestRequest.mockReset();
    const { json, exitCode } = await captureStdout(() =>
      walletBalanceAtCommand(WALLET, { slot: "1", json: true }));

    expect(exitCode).toBe(53);
    expect(json?.error_code).toBe("INVALID_INPUT");
    expect(h.mockRestRequest).not.toHaveBeenCalled();
  });
});
